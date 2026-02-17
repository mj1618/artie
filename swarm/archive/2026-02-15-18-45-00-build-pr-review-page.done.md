# Task: Build PR Review Page with Diff Viewer and Merge Controls

## Context

The PLAN.md (Phase 5) specifies: "PR review with preview + diff (owner)", "PR approval and merge from within app (merge/squash/rebase)", and "Post-merge branch cleanup option." The PR list page (being built separately) will link to individual PRs, but we also need the actual review page where owners can see the PR diff, approve, and merge — all from within Artie.

### What exists now:
- `convex/github.ts` — Has `getUserGithubToken(ctx)`, `createOctokit(token)`, `getRepo()`, and various GitHub API actions
- `convex/projects.ts` — Has `get` query for repos, `listByTeam` query
- `src/components/chat/DiffView.tsx` — Existing diff viewer component (used for change preview in chat)
- `src/components/layout/Sidebar.tsx` — Sidebar navigation
- No `src/app/(dashboard)/pull-requests/` directory exists yet (PR list page is a separate todo)

### What's missing:
- No Convex action to fetch a single PR's details and diff
- No Convex action to merge a PR
- No PR review page with diff viewer and merge controls

## Requirements

### 1. Add `getPullRequestDetail` action to `convex/github.ts`

Fetches details for a single PR including its file diffs:

```typescript
export const getPullRequestDetail = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected.");
    }
    const octokit = createOctokit(token);

    // Fetch PR details
    const { data: pr } = await octokit.pulls.get({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
    });

    // Fetch PR files (diffs)
    const { data: files } = await octokit.pulls.listFiles({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
      per_page: 100,
    });

    // Fetch PR reviews
    const { data: reviews } = await octokit.pulls.listReviews({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
    });

    return {
      prNumber: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      state: pr.state,
      author: pr.user?.login ?? "unknown",
      authorAvatar: pr.user?.avatar_url ?? "",
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      isDraft: pr.draft ?? false,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
      merged: pr.merged,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      htmlUrl: pr.html_url,
      repoFullName: `${repo.githubOwner}/${repo.githubRepo}`,
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status, // "added" | "removed" | "modified" | "renamed"
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
        previousFilename: f.previous_filename,
      })),
      reviews: reviews.map((r) => ({
        user: r.user?.login ?? "unknown",
        state: r.state, // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED"
        body: r.body ?? "",
        submittedAt: r.submitted_at ?? "",
      })),
    };
  },
});
```

### 2. Add `mergePullRequest` action to `convex/github.ts`

Allows the owner to merge a PR with a chosen strategy:

```typescript
export const mergePullRequest = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
    mergeMethod: v.union(v.literal("merge"), v.literal("squash"), v.literal("rebase")),
    deleteBranch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected.");
    }
    const octokit = createOctokit(token);

    // Merge the PR
    const { data: mergeResult } = await octokit.pulls.merge({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
      merge_method: args.mergeMethod,
    });

    // Optionally delete the source branch
    if (args.deleteBranch) {
      const { data: pr } = await octokit.pulls.get({
        owner: repo.githubOwner,
        repo: repo.githubRepo,
        pull_number: args.prNumber,
      });
      try {
        await octokit.git.deleteRef({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          ref: `heads/${pr.head.ref}`,
        });
      } catch {
        // Branch may have already been deleted (auto-delete setting)
      }
    }

    return {
      merged: mergeResult.merged,
      message: mergeResult.message,
      sha: mergeResult.sha,
    };
  },
});
```

### 3. Create the PR review page at `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx`

A page showing the full PR details with:

- **Header**: PR title, number, author, branch info (head → base), open/merged status
- **PR body**: Rendered as markdown (reuse `MarkdownContent` component from chat)
- **File changes list**: Collapsible file sections showing unified diffs
  - File header: filename, status badge (added/removed/modified), +/- counts
  - Diff content: Use the existing `DiffView.tsx` component pattern, or render the GitHub-provided patch
- **Merge controls** (bottom sticky bar):
  - Merge method selector: dropdown with Merge, Squash, Rebase options
  - "Delete branch after merge" checkbox
  - "Merge" button (disabled if not mergeable or already merged)
  - Status indicator showing mergeable state (conflicts, checks pending, etc.)
- **Reviews section**: List of review states (approved, changes requested)
- **Loading/error states**: Skeleton while loading, error message on failure
- **Back link**: "← Back to Pull Requests" link at the top

```tsx
"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/lib/useToast";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

// ... component implementation
```

### 4. Run codegen and verify

- Run `npx convex dev --once` to regenerate API types with the new actions
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add `getPullRequestDetail` and `mergePullRequest` actions |
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | **Create** | PR review page with diff viewer, merge controls, and review status |

## Acceptance Criteria

1. Navigating to `/pull-requests/{repoId}/{prNumber}` shows the PR review page
2. The page loads PR details including title, body, author, branch info, and mergeable state
3. File diffs are displayed with filename, status badges, and +/- line counts
4. Each file's patch/diff is rendered in a readable format (unified diff style)
5. The PR body is rendered as markdown
6. Merge controls show a merge method dropdown (merge/squash/rebase) and a merge button
7. A "Delete branch after merge" checkbox is available
8. Clicking "Merge" calls the `mergePullRequest` action and shows success/error feedback via toast
9. The merge button is disabled when the PR is already merged or has merge conflicts
10. A "Back to Pull Requests" link navigates back to `/pull-requests`
11. Loading skeleton is shown while fetching PR details
12. Error state is shown if the fetch fails
13. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useAction` (not `useQuery`) since these are GitHub API calls — actions are one-shot
- Call the action in a `useEffect` on mount (same pattern as `RepoBrowser`)
- The `repoId` param needs to be cast as `Id<"repos">` from the URL param string
- `octokit.pulls.listFiles` returns a `patch` field with unified diff format — render this directly rather than building diffs client-side
- The existing `DiffView.tsx` component renders diffs from `originalContent`/`content` pairs; for PR review, we're rendering GitHub's `patch` text directly, so create a simpler `PatchView` inline component that renders the patch with syntax coloring (+green/-red)
- `mergeable` can be `null` while GitHub is computing merge status — show a "Checking..." indicator in that case
- The merge controls should be in a sticky bottom bar so they're always visible while scrolling through diffs
- Reuse `MarkdownContent` from chat for rendering the PR body

## Completion Summary

### What was built
PR review page with diff viewer and merge controls, allowing users to view PR details, inspect file diffs, and merge PRs from within Artie.

### Files modified
| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modified** | Added `getPullRequestDetail` and `mergePullRequest` actions. `getPullRequestDetail` fetches PR details, files (diffs), and reviews using `Promise.all` for parallel requests. `mergePullRequest` merges with chosen strategy (merge/squash/rebase) and optionally deletes the source branch. |
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | **Created** | Full PR review page with: header (title, status badge, author, branches, stats), markdown-rendered PR body, collapsible file diffs with color-coded unified patch view, reviews section, sticky merge controls bar with method selector/delete branch checkbox/merge button, loading skeleton, error state, and back navigation. |
| `src/app/(dashboard)/pull-requests/page.tsx` | **Modified** | Updated PR list cards to link to the in-app review page (`/pull-requests/{repoId}/{prNumber}`) instead of GitHub. |

### Acceptance criteria verified
- All 13 acceptance criteria met
- `tsc --noEmit` passes with no errors
- Browser-tested with real PR data: page renders correctly with header, description, diff, and merge controls

## Review (3bec344b)

### Files Reviewed
- `convex/github.ts` — `getPullRequestDetail` and `mergePullRequest` actions
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — PR review page
- `src/app/(dashboard)/pull-requests/page.tsx` — PR list page

### No Issues Found
- All imports resolve correctly (relative paths for `convex/_generated`, `@/` paths for `src/` modules)
- `"use client"` directive present on both pages
- Backend action return types match frontend TypeScript interfaces
- `PatchView` renders diffs with correct color coding (green for additions, red for deletions, muted for hunk headers)
- Merge controls properly disable when `mergeable === false` or `merging` is true
- Branch deletion after merge wrapped in try/catch
- Loading/error/empty states handled correctly
- `tsc --noEmit` passes cleanly
