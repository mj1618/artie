# Task: Add Error Toast and Retry for Failed WebContainer File Changes

## Context

Phase 7 (Polish & Launch) includes "Error handling and edge cases" and "User feedback and notifications." When the AI generates file changes and they fail to apply to the WebContainer, the user currently gets **zero feedback** — the error is only logged to `console.error`. This is a critical UX gap: the user sees the AI say "I've made changes to your files" but nothing actually happens in the preview, and they have no idea why.

The `ChatPanel.tsx` already imports `useToast` and uses it for AI response errors — the file change application block just doesn't use it.

### What exists now:
- `src/components/chat/ChatPanel.tsx` lines 70-87 — `useEffect` that applies file changes to WebContainer. On error, only calls `console.error` (line 82).
- `useToast` is already imported and available as `toast` (line 34).
- `latestChange` query returns the most recent unapplied file change for the session.
- `markApplied` mutation marks a file change as applied.
- `convex/fileChanges.ts` — Backend with `markApplied` mutation.

### What's missing:
- No toast shown when file application fails
- No way for the user to retry applying changes
- No visual indication on the message that the change failed to apply
- The `fileChanges` schema has no `error` state — only `applied` and `reverted`

## Requirements

### 1. Add toast feedback for file application errors

In `ChatPanel.tsx`, update the `applyChanges` catch block to show a toast:

**Before (lines 81-83):**
```tsx
} catch (err) {
  console.error("Failed to apply file changes to WebContainer:", err);
}
```

**After:**
```tsx
} catch (err) {
  console.error("Failed to apply file changes to WebContainer:", err);
  toast({
    type: "error",
    message: "Failed to apply changes to the preview. Try refreshing the preview.",
  });
}
```

This is a one-line addition since `toast` is already available in scope.

### 2. Add `markFailed` mutation to fileChanges backend

Add a `markFailed` mutation to `convex/fileChanges.ts` that sets an `error` field on the file change document:

```typescript
export const markFailed = mutation({
  args: {
    fileChangeId: v.id("fileChanges"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, {
      error: args.error,
    });
  },
});
```

### 3. Add `error` field to fileChanges schema

In `convex/schema.ts`, add an optional `error` field to the `fileChanges` table:

```typescript
fileChanges: defineTable({
  // ... existing fields ...
  error: v.optional(v.string()), // Error message if application failed
})
```

### 4. Call `markFailed` on error in ChatPanel

Update the catch block to also mark the file change as failed so the UI can show it:

```tsx
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : "Unknown error";
  console.error("Failed to apply file changes to WebContainer:", err);
  toast({
    type: "error",
    message: "Failed to apply changes to the preview. Try refreshing the preview.",
  });
  await markFailed({
    fileChangeId: latestChange!._id,
    error: errorMsg,
  }).catch(() => {}); // Best-effort, don't fail if this fails
}
```

### 5. Add a "Retry" button to ChangePreview for failed changes

In `src/components/chat/ChangePreview.tsx`, check if the file change has an `error` field. If so, show a warning banner with a "Retry" button:

```tsx
{fileChange?.error && !fileChange.applied && (
  <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
    <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
    <span className="flex-1">Failed to apply to preview</span>
    <button
      onClick={onRetry}
      className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
    >
      Retry
    </button>
  </div>
)}
```

### 6. Add retry handler in ChatPanel

Add a `retryApplyChanges` function that clears the error and re-applies:

```tsx
const clearFileChangeError = useMutation(api.fileChanges.clearError);

const retryApplyChanges = async (fileChangeId: Id<"fileChanges">) => {
  try {
    // Clear the error first so the effect picks it up again
    await clearFileChangeError({ fileChangeId });
  } catch (err) {
    toast({
      type: "error",
      message: "Failed to retry. Please refresh the page.",
    });
  }
};
```

And add a `clearError` mutation to `convex/fileChanges.ts`:

```typescript
export const clearError = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, { error: undefined });
  },
});
```

When the error is cleared, the `latestChange` query will return a change that's not applied and not errored, which triggers the `useEffect` to retry applying it.

### 7. Update the useEffect guard to skip errored changes

Update the guard condition in the `useEffect` to also skip changes with errors (so they don't loop):

**Before:**
```tsx
if (!latestChange || latestChange.applied || latestChange.reverted) return;
```

**After:**
```tsx
if (!latestChange || latestChange.applied || latestChange.reverted || latestChange.error) return;
```

### 8. Thread the retry callback through to ChangePreview

Pass `retryApplyChanges` from ChatPanel through MessageList → MessageBubble → ChangePreview. The simplest approach: pass it as an `onRetryFileChange` prop.

In `ChatPanel.tsx`:
```tsx
<MessageList
  messages={messages ?? []}
  repoId={repoId}
  fileChangesByMessageId={fileChangesByMessageId}
  streaming={sending}
  sessionBranch={...}
  onRetryFileChange={retryApplyChanges}
/>
```

In `MessageList.tsx`, pass through to `MessageBubble`:
```tsx
<MessageBubble
  ...
  onRetryFileChange={onRetryFileChange}
/>
```

In `MessageBubble.tsx`, pass through to `ChangePreview`:
```tsx
<ChangePreview
  ...
  onRetry={() => onRetryFileChange?.(fileChangeId)}
/>
```

### 9. Verify

- Run `npx -s convex codegen` to regenerate API types after schema change
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Test by triggering a file change error (e.g., disconnect WebContainer) and verify the toast appears and the retry button shows

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add optional `error` field to `fileChanges` table |
| `convex/fileChanges.ts` | **Modify** | Add `markFailed` and `clearError` mutations |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Add toast on error, call `markFailed`, add `retryApplyChanges`, update useEffect guard, pass retry prop |
| `src/components/chat/MessageList.tsx` | **Modify** | Pass through `onRetryFileChange` prop |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Pass through `onRetryFileChange` to ChangePreview |
| `src/components/chat/ChangePreview.tsx` | **Modify** | Show error banner with "Retry" button when `fileChange.error` is set |

## Acceptance Criteria

1. When file changes fail to apply to WebContainer, a toast notification appears with "Failed to apply changes to the preview"
2. The file change document gets an `error` field set with the error message
3. The `useEffect` does NOT retry errored changes in a loop (guard checks for `error`)
4. The ChangePreview component shows an amber warning banner with "Failed to apply to preview" when `error` is set
5. The warning banner includes a "Retry" button
6. Clicking "Retry" clears the error and re-triggers the apply effect
7. If retry succeeds, the error banner disappears and the change is marked as applied
8. If retry fails again, the error toast reappears and the banner stays
9. `npx -s convex codegen` succeeds after schema change
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `useToast` hook is already imported in ChatPanel.tsx (line 11) and destructured as `{ toast }` (line 34). No new imports needed for the toast.
- The `markFailed` mutation is a best-effort call inside the catch — wrap it in `.catch(() => {})` so a backend failure doesn't mask the original error.
- The `clearError` approach works because Convex queries are reactive: when the `error` field is cleared, the `latestChange` query re-evaluates, the `useEffect` fires, and the apply logic runs again.
- Don't add a `retryCount` or exponential backoff — this is a user-initiated retry, not automatic. The user clicks "Retry" when they think the issue is resolved.
- The `error` field is `v.optional(v.string())` — when undefined, no error. When set, contains the error message. `clearError` patches it to `undefined`.
- ChangePreview already receives `fileChange` data from a query — check if the `error` field is accessible. If not, the query in `MessageBubble.tsx` (`api.fileChanges.getByMessage`) should include it.

---

## Implementation Summary

### What was built
Added error toast notifications and a retry mechanism for failed WebContainer file changes. When the AI generates file changes that fail to apply, users now see a toast notification and an amber error banner with a "Retry" button on the ChangePreview component.

### Files modified
| File | Changes |
|------|---------|
| `convex/schema.ts` | Added optional `error: v.optional(v.string())` field to `fileChanges` table |
| `convex/fileChanges.ts` | Added `markFailed` and `clearError` mutations |
| `src/components/chat/ChatPanel.tsx` | Added error toast on file apply failure, `markFailed` call (best-effort), `retryApplyChanges` handler, `useEffect` guard for errored changes, passed `onRetryFileChange` prop to MessageList |
| `src/components/chat/MessageList.tsx` | Added `onRetryFileChange` prop and threaded it through to MessageBubble |
| `src/components/chat/MessageBubble.tsx` | Added `onRetryFileChange` prop and passed `error`/`onRetry` to ChangePreview |
| `src/components/chat/ChangePreview.tsx` | Added `error` and `onRetry` props; renders amber warning banner with "Failed to apply to preview" text and "Retry" button when error is set |

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- Browser test: workspace page renders correctly with no console errors related to the changes

## Review (agent 5e6ecf4f)

Reviewed all 6 modified files. No issues found:
- **ChatPanel.tsx**: `markFailed` and `clearFileChangeError` mutations correctly imported; `retryApplyChanges` properly calls `clearFileChangeError`; useEffect guard at line 74 correctly skips errored changes; `onRetryFileChange` prop passed to MessageList
- **MessageList.tsx**: `onRetryFileChange` prop correctly typed as `(fileChangeId: Id<"fileChanges">) => void` and threaded to MessageBubble
- **MessageBubble.tsx**: `onRetryFileChange` correctly destructured and passed to ChangePreview via `onRetry` with proper arrow function wrapping
- **ChangePreview.tsx**: `error` and `onRetry` props correctly defined; amber warning banner renders conditionally on `error && !reverted`; retry button only shown when `onRetry` callback exists
- **convex/fileChanges.ts**: `markFailed` and `clearError` mutations properly defined with correct Convex db.patch API (table name as first arg)
- **convex/schema.ts**: `error: v.optional(v.string())` field correctly added to `fileChanges` table
- TypeScript check (`npx tsc --noEmit`) passes with zero errors
- No fixes needed
