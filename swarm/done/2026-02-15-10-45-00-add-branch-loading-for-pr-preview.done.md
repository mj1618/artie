# Task: Add Branch Loading for PR Live Preview

## Context

The PLAN.md (Phase 5) specifies: "PR preview in WebContainers (load PR branch for live preview)" and "PR diff viewer alongside live preview." The PR review page (separate todo) will show diffs and merge controls, but the key differentiator for Artie is letting owners **see the PR changes running live** — not just read diffs.

### What exists now:
- `convex/github.ts` — Has `fetchRepoForWebContainer` action, but it **always uses `repo.defaultBranch`**. There's no way to fetch a different branch (like a PR's head branch).
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Hook that boots WebContainer and loads repo files. Calls `fetchRepoForWebContainer` with just `repoId`.
- `src/components/preview/PreviewPanel.tsx` — Renders the WebContainer iframe with the preview.
- The PR review page (separate todo) will be at `/pull-requests/[repoId]/[prNumber]` and needs to embed a live preview.

### What's missing:
- `fetchRepoForWebContainer` doesn't accept a `branch` parameter — it hardcodes `defaultBranch`
- No action to fetch repo contents from a specific branch/ref
- `useWorkspaceContainer` hook doesn't support loading a specific branch
- No way for the PR review page to show a live preview of the PR's branch

## Requirements

### 1. Add optional `branch` parameter to `fetchRepoForWebContainer` in `convex/github.ts`

Update the existing action to accept an optional `branch` argument. When provided, use it instead of `repo.defaultBranch`:

```typescript
export const fetchRepoForWebContainer = action({
  args: {
    repoId: v.id("repos"),
    branch: v.optional(v.string()),  // <-- ADD THIS
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected...");
    }
    const octokit = createOctokit(token);

    const ref = args.branch ?? repo.defaultBranch;  // <-- USE THIS

    // 1. Get the tree (use `ref` instead of `repo.defaultBranch`)
    const { data } = await octokit.git.getTree({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      tree_sha: ref,          // <-- CHANGED
      recursive: "1",
    });

    // ... rest stays the same, but fetchFileBatch calls also use `ref`
  },
});
```

Also update `fetchRepoTree` and `fetchFileContents` the same way — add optional `branch` param, default to `repo.defaultBranch`.

### 2. Update `useWorkspaceContainer` hook to accept optional `branch` prop

In `src/lib/webcontainer/useWorkspaceContainer.ts`, add an optional `branch` parameter:

```typescript
export function useWorkspaceContainer(
  repoId: Id<"repos"> | null,
  options?: { branch?: string }
) {
  // When calling fetchRepoForWebContainer, pass the branch:
  const fsTree = await fetchRepoForWebContainer({ repoId, branch: options?.branch });
  // ...
}
```

The existing workspace page passes no branch (uses default). The PR review page will pass the PR's head branch.

### 3. Run codegen and verify

- Run `npm -s convex codegen` to regenerate API types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add optional `branch` param to `fetchRepoForWebContainer`, `fetchRepoTree`, and `fetchFileContents`. Use it as the git ref instead of hardcoded `defaultBranch`. |
| `src/lib/webcontainer/useWorkspaceContainer.ts` | **Modify** | Add optional `branch` option to the hook; pass it through to the `fetchRepoForWebContainer` action call. |

## Acceptance Criteria

1. `fetchRepoForWebContainer({ repoId })` (no branch) continues to work exactly as before — loads the default branch
2. `fetchRepoForWebContainer({ repoId, branch: "feature/my-pr" })` loads files from the specified branch
3. `fetchRepoTree` and `fetchFileContents` also accept optional `branch` parameter
4. `useWorkspaceContainer(repoId)` (no options) works unchanged — existing workspace pages are unaffected
5. `useWorkspaceContainer(repoId, { branch: "feature/my-pr" })` loads the specified branch into the WebContainer
6. No existing functionality is broken — the workspace page continues to work with default branch
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a **non-breaking change** — the `branch` param is optional and defaults to `defaultBranch`
- The `fetchFileBatch` internal helper already accepts a `ref` parameter, so the plumbing is there — we just need to thread the optional `branch` through the public actions
- The PR review page (separate todo) will use this to load the PR's `headBranch` for live preview
- The `tree_sha` parameter in `octokit.git.getTree` accepts branch names, tags, and SHAs — passing a branch name works fine
- The `ref` parameter in `octokit.repos.getContent` (used by `fetchFileBatch`) also accepts branch names
- Keep the cache key in `useWorkspaceContainer` branch-aware so switching branches properly re-fetches

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/github.ts` | Added optional `branch: v.optional(v.string())` arg to `fetchRepoForWebContainer`, `fetchRepoTree`, and `fetchFileContents`. Each action now computes `const ref = args.branch ?? repo.defaultBranch` and uses `ref` instead of hardcoded `repo.defaultBranch` for tree fetching and file content fetching. |
| `src/lib/webcontainer/useWorkspaceContainer.ts` | Added optional third parameter `options?: { branch?: string }` to the hook. Passes `branch: options?.branch` to `fetchRepoFiles` calls in both `boot()` and `refreshFiles()`. Added `options?.branch` to dependency arrays of both callbacks. |

### What Was Built
- Non-breaking optional `branch` parameter threaded through all three GitHub fetch actions (`fetchRepoForWebContainer`, `fetchRepoTree`, `fetchFileContents`)
- Branch support in `useWorkspaceContainer` hook via optional `options.branch` parameter
- Existing callers (workspace page, PreviewPanel) are completely unaffected — they pass no branch and get the default branch as before
- PR review page and feature-branch sessions can now pass a specific branch to load into the WebContainer

### Verification
- `npx convex codegen` passed successfully
- `npx tsc -p tsconfig.json --noEmit` passed with zero errors
- Browser testing confirmed the workspace page loads and the WebContainer boots through all phases (booting → fetching → mounting → installing) with the default branch path unchanged
