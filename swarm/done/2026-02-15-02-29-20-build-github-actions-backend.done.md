# Task: Build GitHub Actions Backend (Octokit)

## Context

The WebContainer boot infrastructure is being built (in progress), but there's no backend to actually fetch repository files from GitHub. The current `addRepo` mutation just stores metadata (owner, repo name, branch) — it never talks to the GitHub API. Before the WebContainer can show a live preview, we need Convex actions that use Octokit to:

1. List the file tree of a repo
2. Fetch individual file contents
3. Fetch the full repo tree for loading into WebContainers

This task creates the `convex/github.ts` file with GitHub API actions, and adds a `fetchRepoFiles` action that returns a file tree suitable for mounting into a WebContainer.

### What exists now:
- `convex/schema.ts` — `repos` table with `githubOwner`, `githubRepo`, `defaultBranch`; `userProfiles` table with optional `githubAccessToken`
- `convex/projects.ts` — CRUD for repos, `getRepoWithTeam` query
- `convex/users.ts` — `currentUser`, `getProfile`, `updateProfile`
- No `convex/github.ts` or GitHub API logic exists
- No `octokit` dependency installed
- The `userProfiles.githubAccessToken` field exists in schema but is never populated

### What's needed:
- Install `octokit` (or `@octokit/rest`) package
- Create `convex/github.ts` with actions that use Octokit to interact with GitHub
- These actions will be called from the workspace page to load repo contents into WebContainers

## Requirements

### 1. Install Octokit

```bash
npm install @octokit/rest
```

### 2. Create `convex/github.ts`

Create a `"use node"` action file with the following actions:

**`fetchRepoTree` action:**
Fetches the complete file tree of a repository, returning paths and types (file vs directory). This is used to display the file tree and decide which files to load.

```typescript
"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Octokit } from "@octokit/rest";

export const fetchRepoTree = action({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.runQuery(api.projects.get, { repoId: args.repoId });
    if (!repo) throw new Error("Repository not found");

    // For now, use a GitHub token from env (public repos work without auth,
    // but rate limits are much higher with auth)
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Get the repo tree recursively
    const { data } = await octokit.git.getTree({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      tree_sha: repo.defaultBranch,
      recursive: "1",
    });

    // Filter to relevant files (skip huge files, binaries, node_modules)
    const SKIP_PATTERNS = [
      /^node_modules\//,
      /^\.git\//,
      /^dist\//,
      /^build\//,
      /^\.next\//,
      /\.lock$/,
      /package-lock\.json$/,
    ];

    const files = data.tree
      .filter((item) => {
        if (!item.path) return false;
        if (SKIP_PATTERNS.some((p) => p.test(item.path!))) return false;
        // Skip files larger than 100KB
        if (item.size && item.size > 100_000) return false;
        return true;
      })
      .map((item) => ({
        path: item.path!,
        type: item.type as "blob" | "tree",
        size: item.size ?? 0,
        sha: item.sha!,
      }));

    return files;
  },
});
```

**`fetchFileContents` action:**
Fetches the contents of multiple files in a single action call. Returns a map of path → content. This is the workhorse for loading files into WebContainers.

```typescript
export const fetchFileContents = action({
  args: {
    repoId: v.id("repos"),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.runQuery(api.projects.get, { repoId: args.repoId });
    if (!repo) throw new Error("Repository not found");

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Fetch files in parallel (batch of up to 20 at a time to avoid rate limits)
    const BATCH_SIZE = 20;
    const results: Record<string, string> = {};

    for (let i = 0; i < args.paths.length; i += BATCH_SIZE) {
      const batch = args.paths.slice(i, i + BATCH_SIZE);
      const fetched = await Promise.all(
        batch.map(async (path) => {
          try {
            const { data } = await octokit.repos.getContent({
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              path,
              ref: repo.defaultBranch,
            });
            if ("content" in data && data.encoding === "base64") {
              return { path, content: Buffer.from(data.content, "base64").toString("utf-8") };
            }
            return null;
          } catch {
            // Skip files that can't be fetched (deleted, binary, too large)
            return null;
          }
        }),
      );
      for (const result of fetched) {
        if (result) {
          results[result.path] = result.content;
        }
      }
    }

    return results;
  },
});
```

**`fetchRepoForWebContainer` action:**
A high-level action that fetches the entire repo and returns it in a format ready for WebContainer's `mount()` method (a `FileSystemTree` shape).

```typescript
export const fetchRepoForWebContainer = action({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.runQuery(api.projects.get, { repoId: args.repoId });
    if (!repo) throw new Error("Repository not found");

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // 1. Get the tree
    const { data: treeData } = await octokit.git.getTree({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      tree_sha: repo.defaultBranch,
      recursive: "1",
    });

    const SKIP_PATTERNS = [
      /^node_modules\//,
      /^\.git\//,
      /^dist\//,
      /^build\//,
      /^\.next\//,
      /\.lock$/,
      /package-lock\.json$/,
    ];

    const filePaths = treeData.tree
      .filter((item) => {
        if (item.type !== "blob" || !item.path) return false;
        if (SKIP_PATTERNS.some((p) => p.test(item.path!))) return false;
        if (item.size && item.size > 100_000) return false;
        return true;
      })
      .map((item) => item.path!);

    // 2. Fetch file contents in parallel batches
    const BATCH_SIZE = 20;
    const fileContents: Record<string, string> = {};

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const fetched = await Promise.all(
        batch.map(async (path) => {
          try {
            const { data } = await octokit.repos.getContent({
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              path,
              ref: repo.defaultBranch,
            });
            if ("content" in data && data.encoding === "base64") {
              return { path, content: Buffer.from(data.content, "base64").toString("utf-8") };
            }
            return null;
          } catch {
            return null;
          }
        }),
      );
      for (const result of fetched) {
        if (result) {
          fileContents[result.path] = result.content;
        }
      }
    }

    // 3. Build WebContainer FileSystemTree structure
    // The shape is: { "path": { file: { contents: "..." } }, "dir": { directory: { ... } } }
    const fsTree: Record<string, unknown> = {};

    for (const [filePath, content] of Object.entries(fileContents)) {
      const parts = filePath.split("/");
      let current = fsTree;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = { directory: {} };
        }
        current = (current[parts[i]] as { directory: Record<string, unknown> }).directory;
      }

      const fileName = parts[parts.length - 1];
      current[fileName] = { file: { contents: content } };
    }

    return fsTree;
  },
});
```

### 3. Add `GITHUB_TOKEN` to environment notes

The `GITHUB_TOKEN` environment variable is used for GitHub API access. For public repos it's optional (but increases rate limits from 60/hr to 5000/hr). For private repos, the user's personal access token from `userProfiles.githubAccessToken` should be used in the future.

For now, using `process.env.GITHUB_TOKEN` is a reasonable starting point. In a later task, this will be replaced with the user's own token from their profile when GitHub OAuth is implemented.

### 4. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `package.json` | **Modify** | Add `@octokit/rest` dependency via `npm install` |
| `convex/github.ts` | **Create** | GitHub API actions: `fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer` |

## Acceptance Criteria

1. `@octokit/rest` is installed in `package.json`
2. `convex/github.ts` exists with `"use node"` directive
3. `fetchRepoTree` action returns filtered file tree (paths, types, sizes, shas) for a given repo
4. `fetchFileContents` action returns a map of path → content for specified file paths
5. `fetchRepoForWebContainer` action returns a WebContainer-compatible `FileSystemTree` object
6. Large files (>100KB), `node_modules`, `.git`, `dist/`, `build/`, `.next/`, lock files are skipped
7. File content fetching is batched (20 at a time) to avoid GitHub API rate limits
8. `npm -s convex codegen` completes successfully
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This file uses `"use node"` directive because `@octokit/rest` and `Buffer` require a Node.js runtime
- Octokit's `repos.getContent` returns base64-encoded file contents — decode with `Buffer.from(content, "base64").toString("utf-8")`
- `git.getTree` with `recursive: "1"` returns the entire file tree in one API call (efficient)
- The `FileSystemTree` format for WebContainer mount is: `{ "filename": { file: { contents: "..." } }, "dirname": { directory: { ...nested... } } }`
- The `SKIP_PATTERNS` filter avoids loading unnecessary large directories. `package-lock.json` is skipped because WebContainers will regenerate it via `npm install`
- Rate limit: unauthenticated GitHub API = 60 req/hr, authenticated = 5000 req/hr. Use `GITHUB_TOKEN` env var for now
- In the future, `process.env.GITHUB_TOKEN` should be replaced with the user's own token from `userProfiles.githubAccessToken` when GitHub OAuth is wired up
- The `projects.get` query is already exported and returns the repo document — reuse it for auth-less access to repo metadata within actions

## Completion Summary

### What was built
Created `convex/github.ts` — a `"use node"` Convex action file with three GitHub API actions using `@octokit/rest`:

- **`fetchRepoTree`** — Fetches the complete file tree of a repo (recursive), filtering out `node_modules`, `.git`, `dist/`, `build/`, `.next/`, lock files, and files >100KB. Returns array of `{ path, type, size, sha }`.
- **`fetchFileContents`** — Fetches contents of specified file paths in batches of 20. Returns `Record<string, string>` (path → content).
- **`fetchRepoForWebContainer`** — High-level action that fetches the entire repo tree + contents and builds a WebContainer-compatible `FileSystemTree` structure for `mount()`.

### Implementation notes
- Extracted shared helpers (`createOctokit`, `shouldSkip`, `fetchFileBatch`, `getRepo`) to reduce code duplication
- Used a `getRepo` helper with explicit `RepoInfo` return type to break circular type inference (Convex codegen circular reference issue with `api` imports)
- Uses `process.env.GITHUB_TOKEN` for GitHub API auth (optional for public repos, required for private repos)

### Files changed
| File | Action |
|------|--------|
| `package.json` / `package-lock.json` | Modified — added `@octokit/rest` dependency |
| `convex/github.ts` | **Created** — 3 actions: `fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer` |
| `convex/_generated/api.d.ts` | Auto-regenerated by `convex codegen` |

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (0 errors)
- `npm run build` — passed
- Browser test (playwright-cli) — app loads correctly, no regressions

## Reviewer Notes (agent ccb8965e, iteration 2)

Reviewed `convex/github.ts` — clean. `"use node"` directive correct, shared helpers (`createOctokit`, `shouldSkip`, `fetchFileBatch`, `getRepo`) well-factored, file batching logic correct. No issues found.

## Reviewer Notes (agent ff8f3dfc, iteration 3)

**Full codebase review** — reviewed all 40+ source files across frontend (pages, components, hooks) and backend (convex functions, schema).

### Fixes applied

1. **`src/lib/webcontainer/useWorkspaceContainer.ts`** — Fixed broken imports: `@/convex/_generated/dataModel` and `@/convex/_generated/api` don't resolve because `@/` maps to `./src/*`, not project root. Changed to relative `../../../convex/_generated/...` paths.

2. **`src/components/preview/PreviewPanel.tsx`** — Same broken `@/convex/_generated/` import issue. Fixed to relative `../../../convex/_generated/...` paths. (Note: this file was rewritten by a recent agent to integrate `useWorkspaceContainer` hook with WebContainer phases, terminal output, and error/retry UI.)

3. **`tsconfig.json`** — Added `builds` to the `exclude` array. Stale build artifacts in `builds/*/types/` (route validators from previous builds) were being included in TS compilation via the `**/*.ts` glob. Not currently causing errors, but would break when routes change.

### Files reviewed (no issues found)

**Convex backend (11 files):**
- `convex/ai.ts` — `"use node"` correct, team-level LLM config resolution with platform fallback, error handling, lenient response parsing
- `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` — Clean
- `convex/github.ts` — `"use node"` correct, Octokit usage, shared helpers, file batching, WebContainer tree builder
- `convex/messages.ts` — `send`, `list`, `markChangesCommitted` correct
- `convex/projects.ts` — All CRUD functions with proper auth/ownership checks
- `convex/schema.ts` — All tables and indexes consistent with usage
- `convex/sessions.ts` — `create`, `get`, `listByRepo`, `getPreviewCode`, `updatePreviewCode`, `createDemo` all correct
- `convex/teams.ts` — All 13 functions including invite flow, LLM settings, internal query have proper auth
- `convex/users.ts` — `currentUser`, `getProfile`, `updateProfile` with upsert pattern correct

**Frontend pages (12 files):**
- `src/app/page.tsx` — Landing page with auth check, redirect to `/home`
- `src/app/(auth)/login/page.tsx`, `signup/page.tsx`, `layout.tsx` — Clean
- `src/app/(dashboard)/layout.tsx` — Auth guard
- `src/app/(dashboard)/home/page.tsx` — Dashboard with PendingInvites, settings gear
- `src/app/(dashboard)/settings/page.tsx` — Profile edit, sign out
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Members, invites, repos, LLM settings link
- `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` — Provider/model/key config
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Owner-only edit, disconnect dialog
- `src/app/workspace/[repoId]/page.tsx` — Auth guard, repo loading, passes repoId to PreviewPanel

**Shared components (6 files):**
- `src/components/layout/Header.tsx`, `SplitPane.tsx` — Clean
- `src/components/chat/ChatPanel.tsx`, `MessageList.tsx`, `MessageBubble.tsx` — Clean
- `src/components/preview/PreviewPanel.tsx` — Fixed imports, WebContainer integration with phases/terminal/retry

**WebContainer utilities (5 files):**
- `src/lib/webcontainer/index.ts` — Singleton boot/teardown
- `src/lib/webcontainer/files.ts` — Mount, read, write
- `src/lib/webcontainer/detect.ts` — Project type detection
- `src/lib/webcontainer/devServer.ts` — npm install + dev server startup with output streaming
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Fixed imports, boot/fetch/mount/install/start lifecycle hook
- `src/lib/webcontainer/useWebContainer.ts` — Basic boot hook (still present, used less now)

### Verification
- `npx -s tsc -p tsconfig.json --noEmit` — passes clean (zero errors)
- All `"use client"` directives present where needed
- All import paths resolve correctly
- Schema fields and indexes consistent with all queries/mutations
- Auth guards on all protected routes

**3 fixes applied. Codebase is now clean and correct.**
