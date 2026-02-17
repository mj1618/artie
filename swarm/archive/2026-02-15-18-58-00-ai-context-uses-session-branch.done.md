# Task: AI Context Should Fetch Files from Session's Branch

## Context

The `generateResponse` action in `convex/ai.ts` fetches the repo's file tree and file contents from GitHub to build the AI's system prompt. Currently it **always** uses `repo.defaultBranch` as the `tree_sha` (line ~243):

```typescript
const { data: treeData } = await octokit.git.getTree({
  owner: repo.githubOwner,
  repo: repo.githubRepo,
  tree_sha: repo.defaultBranch,  // <-- always default branch
  recursive: "1",
});
```

And file contents are also fetched from `repo.defaultBranch` (line ~284):

```typescript
const { data } = await octokit.repos.getContent({
  owner: repo.githubOwner,
  repo: repo.githubRepo,
  path,
  ref: repo.defaultBranch,  // <-- always default branch
});
```

The feature branch session task (currently processing) adds `branchName` and `featureName` fields to sessions. Once that's done, sessions can be associated with feature branches. But the AI will still read files from `defaultBranch`, which means:

- If a user is working on branch `feature/update-hero` and the branch already has commits on GitHub, the AI won't see those changes
- The AI context will be stale/incorrect for any session on a non-default branch
- This breaks the iterative development flow where users push changes, then continue chatting

### What exists now:
- `convex/ai.ts` — `generateResponse` action fetches tree and files from `repo.defaultBranch`
- `convex/sessions.ts` — `get` query returns the session, which now includes optional `branchName`
- The session is already fetched in `generateResponse` (line ~192): `const session = await ctx.runQuery(api.sessions.get, { sessionId: args.sessionId })`

### What's missing:
- `generateResponse` doesn't use `session.branchName` when fetching from GitHub
- No fallback logic: if `session.branchName` is set but the branch doesn't exist on GitHub yet (user hasn't pushed), the API call will fail

## Requirements

### 1. Use session's branch when fetching the file tree

In `convex/ai.ts`, after fetching the session, determine which branch to use:

```typescript
const session = await ctx.runQuery(api.sessions.get, {
  sessionId: args.sessionId,
});
const repo = session
  ? await ctx.runQuery(api.projects.get, { repoId: session.repoId })
  : null;

// Determine which branch to fetch from
const branch = session?.branchName ?? repo?.defaultBranch ?? "main";
```

Then use `branch` instead of `repo.defaultBranch` in both the `getTree` and `getContent` calls:

```typescript
const { data: treeData } = await octokit.git.getTree({
  owner: repo.githubOwner,
  repo: repo.githubRepo,
  tree_sha: branch,  // <-- use session branch
  recursive: "1",
});
```

```typescript
const { data } = await octokit.repos.getContent({
  owner: repo.githubOwner,
  repo: repo.githubRepo,
  path,
  ref: branch,  // <-- use session branch
});
```

### 2. Add fallback for non-existent branches

If the session has a `branchName` but the branch doesn't exist on GitHub yet (e.g., user created a feature session but hasn't pushed), the `getTree` call will 404. Add a try/catch that falls back to `repo.defaultBranch`:

```typescript
let branch = session?.branchName ?? repo.defaultBranch;
let treeData;
try {
  const result = await octokit.git.getTree({
    owner: repo.githubOwner,
    repo: repo.githubRepo,
    tree_sha: branch,
    recursive: "1",
  });
  treeData = result.data;
} catch {
  // Branch doesn't exist on GitHub yet, fall back to default
  branch = repo.defaultBranch;
  const result = await octokit.git.getTree({
    owner: repo.githubOwner,
    repo: repo.githubRepo,
    tree_sha: branch,
    recursive: "1",
  });
  treeData = result.data;
}
```

Use the same `branch` variable for the subsequent `getContent` calls so they're consistent.

### 3. Run codegen and verify

- Run `npx convex dev --once` (in case session type changed)
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/ai.ts` | **Modify** | Use `session.branchName` (with fallback to `repo.defaultBranch`) when fetching file tree and file contents from GitHub |

## Acceptance Criteria

1. When a session has a `branchName`, the AI fetches the file tree from that branch
2. When a session has a `branchName`, file contents are fetched from that branch
3. When a session has no `branchName` (legacy sessions), the default branch is used (unchanged behavior)
4. If the session's branch doesn't exist on GitHub (not yet pushed), it falls back to the default branch gracefully
5. The `branch` variable is consistent between `getTree` and `getContent` calls (no mixing branches)
6. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a small, focused change to `convex/ai.ts` only
- The session is already fetched in `generateResponse` — just need to extract `branchName` from it
- The fallback is important because feature branch sessions create the branch name at session creation time, but the branch isn't created on GitHub until the first push
- Session edits (from `fileChanges` table) still overlay on top of the fetched files, so even if we fall back to `defaultBranch`, any local edits the user made in this session will still be in the AI context
- This task can be completed independently of the feature branch session task — if `session.branchName` is undefined (old sessions), the fallback to `repo.defaultBranch` preserves existing behavior

## Completion Summary

### What was built
Updated `generateResponse` in `convex/ai.ts` to use the session's `branchName` when fetching the file tree and file contents from GitHub, with a graceful fallback to `repo.defaultBranch` if the branch doesn't exist yet.

### Changes made
- **`convex/ai.ts`**:
  - Added `let branch = session?.branchName ?? repo.defaultBranch` to resolve which branch to fetch from
  - Wrapped `octokit.git.getTree()` in a try/catch: attempts the session branch first, falls back to `repo.defaultBranch` if the branch doesn't exist on GitHub
  - Changed `octokit.repos.getContent()` to use `ref: branch` instead of `ref: repo.defaultBranch`, ensuring file contents are fetched from the same resolved branch

### Files changed
| File | Action |
|------|--------|
| `convex/ai.ts` | Modified |

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed, no TypeScript errors
- Browser tested: app loads, workspace renders correctly, existing sessions (without branchName) work as before

## Review (2c12e473)

### Files Reviewed
- `convex/ai.ts` — `generateResponse` action, branch resolution logic, getTree/getContent calls

### No Issues Found
- `let branch = session?.branchName ?? repo.defaultBranch` correctly resolves to session branch with fallback
- Try/catch around `octokit.git.getTree()` correctly falls back to `repo.defaultBranch` if the session branch doesn't exist on GitHub
- `ref: branch` in `octokit.repos.getContent()` uses the same resolved branch variable, ensuring consistency between tree and file fetches
- Session edits still overlay on top of fetched files (line 321-323), so local changes are preserved regardless of branch resolution
- Legacy sessions without `branchName` fall back to `repo.defaultBranch` (backward compatible)
- Schema confirms `branchName` is `v.optional(v.string())` on sessions table
- `tsc --noEmit` passes cleanly

## Review 2 (d4717530)

Second-pass review confirmed: no issues found. Branch resolution, try/catch fallback, and consistent `ref: branch` usage all verified correct.
