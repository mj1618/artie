# Task: Add Push Success Feedback with Commit/PR Link

## Context

Phase 7 (Polish & Launch) includes "User feedback and notifications." The push-to-GitHub flow works end-to-end, but after a successful push, the `PushDialog` silently closes with no confirmation. The user has no idea if the push succeeded, what commit was created, or where to find the PR. This is a significant UX gap for non-technical users who need reassurance that their changes went through.

The `pushChanges` action already returns `{ commitSha, commitUrl?, prUrl?, branchName? }` — this data is just not being used by the frontend.

### What exists now:
- `src/components/chat/PushDialog.tsx` — Push dialog with commit message, branch name, PR title/body fields. On success, calls `onClose()` immediately with no feedback.
- `convex/github.ts` `pushChanges` action — Returns `{ commitSha: string, commitUrl?: string, prUrl?: string, branchName?: string }` on success.
- `src/components/ui/Toast.tsx` — Toast notification system with `useToast()` hook and `addToast({ title, description?, variant? })`.
- `src/components/chat/MessageBubble.tsx` — Renders messages with change data (shows commit SHA and PR URL when present).
- The `ChangePreview` component shows file changes with "Push to GitHub" button that opens the `PushDialog`.

### What's missing:
- No success feedback after pushing (no toast, no link to commit/PR)
- No way for the user to know if the push actually went through until they check GitHub manually
- The `PushDialog` discards the return value from `pushChanges`

## Requirements

### 1. Show success state in PushDialog after push

Instead of immediately closing the dialog on success, transition to a **success view** inside the dialog:

**Success view content:**
- A green checkmark icon
- "Changes pushed successfully!" heading
- If direct push: Show "Committed to `{branch}`" with commit SHA (first 7 chars, monospace) and a "View on GitHub" link (using `commitUrl`)
- If PR: Show "Pull request created on `{branchName}`" with a "View Pull Request" link (using `prUrl`) and the commit SHA
- A "Done" button that closes the dialog

This approach is better than a toast because:
1. It keeps the user's attention on the result (toasts auto-dismiss)
2. It provides a clickable link to view the commit/PR on GitHub
3. It feels more intentional and trustworthy for non-technical users

### 2. Update handlePush to capture return value

```tsx
const [pushResult, setPushResult] = useState<{
  commitSha: string;
  commitUrl?: string;
  prUrl?: string;
  branchName?: string;
} | null>(null);

const handlePush = async () => {
  // ... existing validation ...
  setPushing(true);
  setError(null);
  try {
    const result = await pushChanges({
      repoId,
      messageId,
      fileChangeId,
      commitMessage: commitMessage.trim(),
      ...(isPr
        ? {
            branchName: branchName.trim(),
            prTitle: prTitle.trim(),
            prBody: prBody.trim(),
          }
        : {}),
    });
    setPushResult(result);
    // Do NOT call onClose() here — show success view instead
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Push failed";
    setError(message);
  } finally {
    setPushing(false);
  }
};
```

### 3. Render success view when pushResult is set

After the existing form/error JSX, add a conditional that renders the success view when `pushResult` is not null:

```tsx
if (pushResult) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" ...>
      <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        {/* Green checkmark */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-zinc-100">
            Changes pushed successfully!
          </h3>
          <p className="mt-1 text-sm text-zinc-400">
            {isPr
              ? `Pull request created on ${pushResult.branchName ?? branchName}`
              : `Committed to ${repo.defaultBranch}`}
          </p>
          {/* Commit SHA */}
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {pushResult.commitSha.slice(0, 7)}
          </p>
        </div>

        {/* Action links */}
        <div className="mt-4 flex justify-center gap-3">
          {pushResult.prUrl && (
            <a
              href={pushResult.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              View Pull Request
            </a>
          )}
          {!pushResult.prUrl && pushResult.commitUrl && (
            <a
              href={pushResult.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              View on GitHub
            </a>
          )}
          <button
            onClick={onClose}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 4. Also fire a toast when closing the success view

When the user clicks "Done" on the success view, additionally fire a brief toast so there's a trace of success even after the dialog closes:

In the PushDialog component, accept an `onSuccess` callback or use a toast directly. The simplest approach: pass an `onPushSuccess` prop from the parent that fires a toast.

**Option A (simpler)**: Just import `useToast` directly in PushDialog and fire a toast on close:

```tsx
const { addToast } = useToast();

// In the "Done" button handler:
const handleDone = () => {
  addToast({
    title: isPr ? "Pull request created" : "Changes pushed",
    description: isPr && pushResult?.prUrl
      ? `View at ${pushResult.prUrl}`
      : `Commit ${pushResult?.commitSha.slice(0, 7)}`,
  });
  onClose();
};
```

### 5. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Test both push modes (direct commit and PR) and verify the success view shows correctly
- Verify the "View on GitHub" / "View Pull Request" links open in a new tab
- Verify the "Done" button closes the dialog and shows a toast

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/PushDialog.tsx` | **Modify** | Add `pushResult` state, capture return value from `pushChanges`, render success view with commit/PR link, add toast on close |

## Acceptance Criteria

1. After a successful push, the dialog transitions to a success view (does NOT immediately close)
2. Success view shows a green checkmark, "Changes pushed successfully!" message
3. For direct pushes: shows "Committed to {branch}" with commit SHA
4. For PR pushes: shows "Pull request created on {branch}" with commit SHA
5. A "View Pull Request" link appears when `prUrl` is returned (opens in new tab)
6. A "View on GitHub" link appears when `commitUrl` is returned and no `prUrl` (opens in new tab)
7. A "Done" button closes the dialog
8. Clicking "Done" fires a toast notification summarizing the push result
9. The commit SHA is displayed in monospace, showing first 7 characters
10. Error states still work correctly (error message shown, dialog stays open)
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `pushChanges` action return type is `Promise<{ commitSha: string; commitUrl?: string; prUrl?: string; branchName?: string }>` — the PushDialog already awaits this, just doesn't capture the result.
- `useToast` is imported from `@/components/ui/Toast` — check the existing import path pattern in the file (some files use relative paths like `../../../convex/...`, follow the same pattern).
- The success view replaces the form content inside the same dialog overlay, maintaining visual consistency.
- Keep the backdrop click behavior: clicking outside the success view should also close the dialog (same as current behavior).
- The green checkmark SVG is inline (no icon library needed) — uses Heroicons-style path.
- `commitUrl` may be undefined for some push strategies — only show the link when it's available.
- Follow existing styling: zinc-900 bg, zinc-800 borders, green-600 for primary actions, zinc-400 for secondary text.

## Completion Summary

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/PushDialog.tsx` | **Modified** | Added `pushResult` state and `useToast` hook; updated `handlePush` to capture return value from `pushChanges` instead of calling `onClose()`; added success view with green checkmark, commit SHA, branch info, and "View Pull Request" / "View on GitHub" links; added `handleDone` handler that fires a toast and closes the dialog |

### What Was Built
- After a successful push, the PushDialog now transitions to a success view instead of immediately closing
- Success view shows: green checkmark icon, "Changes pushed successfully!" heading, branch/PR info, commit SHA (first 7 chars, monospace)
- Conditional "View Pull Request" link (when `prUrl` is returned) or "View on GitHub" link (when `commitUrl` is returned)
- "Done" button fires a success toast notification and closes the dialog
- Backdrop click on success view also triggers handleDone (toast + close)
- Error states remain unchanged and continue to work correctly
- TypeScript compilation passes with no errors

## Review (agent 2e1c4d5c)

Reviewed `src/components/chat/PushDialog.tsx`. No issues found:
- `"use client"` directive present
- `useToast` imported from `@/lib/useToast` — matches the codebase-wide pattern (verified against 15+ other files)
- Toast API usage (`toast({ type: "success", message })`) matches the `ToastContextValue` interface in `useToast.tsx`
- `pushResult` state type matches the return type of `pushChanges` action
- `handleDone` safely optional-chains `pushResult?.commitSha` in the toast message
- Success view correctly renders conditional "View Pull Request" / "View on GitHub" links based on `prUrl` and `commitUrl`
- Backdrop click on success view calls `handleDone` (fires toast + closes)
- `repo?.defaultBranch` safely optional-chained in success view text
- TypeScript check passes clean (`npx tsc --noEmit`)
- Also reviewed co-landed error boundary and not-found pages (`src/app/error.tsx`, `src/app/not-found.tsx`) — both correct
- No fixes needed
