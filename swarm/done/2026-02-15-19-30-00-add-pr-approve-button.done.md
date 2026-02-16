# Task: Add PR Approve Button to PR Review Page

## Context

The PR review page (`src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx`) currently shows existing reviews from GitHub and has a merge button, but there's no way for the owner to **approve** a PR from within Artie. The PLAN.md Phase 5 requirement states: "Owner can approve and merge PRs directly from within the application."

The merge button works, the reviews section displays existing reviews, but there's no "Approve" action. This is a clear gap — the owner must currently leave Artie and go to GitHub to approve a PR before merging.

### What exists now:
- `convex/github.ts` — Has `getPullRequestDetail` (fetches PR with reviews) and `mergePullRequest` (merges PR). No approve action.
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — Shows reviews via `ReviewBadge`, has sticky merge controls at bottom with merge method selector and merge button. No approve button.
- The `getUserGithubToken()` and `getRepo()` helpers in `convex/github.ts` handle auth and repo lookup.

### What's missing:
- A `approvePullRequest` action in `convex/github.ts` that calls `octokit.pulls.createReview` with `event: "APPROVE"`
- An "Approve" button in the PR review page's sticky bottom bar
- Optional: A "Request Changes" button (stretch — keep it simple with just Approve for now)

## Requirements

### 1. Add `approvePullRequest` action to `convex/github.ts`

```typescript
export const approvePullRequest = action({
  args: {
    repoId: v.id("repos"),
    prNumber: v.number(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repo = await getRepo(ctx, args.repoId);
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected.");
    }
    const octokit = createOctokit(token);

    await octokit.pulls.createReview({
      owner: repo.githubOwner,
      repo: repo.githubRepo,
      pull_number: args.prNumber,
      event: "APPROVE",
      body: args.body ?? "",
    });

    return { success: true };
  },
});
```

### 2. Add Approve button to the PR review page sticky bottom bar

In `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx`, add an "Approve" button next to the merge controls in the fixed bottom bar. The button should:

- Appear to the LEFT of the merge method selector
- Be styled in green outline (not filled — reserve filled green for merge)
- Show a loading state while submitting
- After approval, re-fetch the PR to update the reviews section
- Be disabled if the PR is already merged or closed

Rough layout for the sticky bottom bar:

```
[Mergeable indicator]  [Delete branch checkbox]  |  [Approve ✓] [merge method v] [Merge]
```

Add state:
```typescript
const [approving, setApproving] = useState(false);

const handleApprove = async () => {
  setApproving(true);
  try {
    await approvePR({
      repoId: repoId as Id<"repos">,
      prNumber: Number(prNumber),
    });
    toast({ type: "success", message: "PR approved" });
    fetchPR(); // Re-fetch to update reviews
  } catch (err) {
    toast({
      type: "error",
      message: err instanceof Error ? err.message : "Failed to approve PR",
    });
  } finally {
    setApproving(false);
  }
};
```

Button UI:
```tsx
<button
  onClick={handleApprove}
  disabled={approving}
  className="rounded-md border border-green-600 px-3 py-1.5 text-sm font-medium text-green-400 hover:bg-green-600/10 disabled:opacity-50"
>
  {approving ? "Approving..." : "Approve"}
</button>
```

### 3. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add `approvePullRequest` action using `octokit.pulls.createReview` with `event: "APPROVE"` |
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | **Modify** | Add Approve button to sticky bottom bar, wire up `useAction(api.github.approvePullRequest)`, add loading/success/error states |

## Acceptance Criteria

1. The PR review page has an "Approve" button in the sticky bottom bar
2. Clicking "Approve" calls the GitHub API to submit an approval review
3. After approval, the reviews section updates to show the new approval
4. Loading and error states are handled (disabled during submit, toast on error)
5. The approve button is only visible when the PR is open (not merged/closed)
6. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- GitHub's `pulls.createReview` API requires the token to have `repo` scope, which our OAuth flow already requests
- Approving your own PR is allowed on GitHub for repos you own (which is the typical Artie use case)
- The `fetchPR()` function already exists in the component and re-fetches the full PR data including reviews — call it after approval to refresh the UI
- No database changes needed — approvals are stored on GitHub, not in Convex

## Completion Summary

### What was built
Added the ability to approve pull requests directly from the Artie PR review page, closing the gap where users had to leave Artie and go to GitHub to approve PRs.

### Files changed
| File | Change |
|------|--------|
| `convex/github.ts` | Added `approvePullRequest` action that calls `octokit.pulls.createReview` with `event: "APPROVE"` |
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | Added Approve button to sticky bottom bar with loading state, toast notifications, and auto-refresh of reviews after approval |

### Verification
- Convex codegen: passed
- TypeScript type-check (`tsc --noEmit`): passed
- Browser test: Confirmed Approve button renders in the sticky bottom bar to the left of the merge method selector, styled with green outline as specified

### Review (292175f9)
- Reviewed `convex/github.ts` approvePullRequest action — clean, correct use of octokit API
- Reviewed `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — `"use client"` present, imports correct, approve button properly guarded behind `!pr.merged && pr.state === "open"`, loading/error states handled via toast, reviews refresh after approval
- TypeScript check: passed (no errors)
- No fixes needed — code looks good

### Review (211ad2b0)
- Second pass review: verified all imports (`useToast`, `MarkdownContent`, `CardSkeleton`, `PreviewPanel`, `api.github.approvePullRequest`), confirmed `PreviewPanel` props match interface, verified Convex codegen includes `approvePullRequest` via module-level type import
- Confirmed `handleApprove` args match backend schema (`repoId: Id<"repos">`, `prNumber: number`)
- No additional issues found — code is clean
