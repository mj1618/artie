# Task: Add Escape Key and Click-Outside Dismiss to Remaining Dialogs

## Context

Phase 7 (Polish & Launch) includes "Error handling and edge cases" and UX polish. The `ConfirmDialog` and `PushDialog` components already implement standard modal accessibility: Escape key to close, click-outside to dismiss, `role="dialog"`, and `aria-modal="true"`. However, two other dialogs in the app are missing these behaviors, creating an inconsistent user experience.

### What exists now:
- `src/components/ui/ConfirmDialog.tsx` — **Has:** Escape key handler (line 32-36), click-outside (line 48-50), `role="dialog"` (line 51), `aria-modal="true"` (line 52)
- `src/components/chat/PushDialog.tsx` — **Has:** Escape key handler (line 84-89), click-outside (multiple instances), `role="dialog"`, `aria-modal="true"`
- `src/app/workspace/[repoId]/page.tsx` — `NewFeatureDialog` — **Missing:** Escape key, click-outside, `role="dialog"`, `aria-modal="true"`
- `src/app/(dashboard)/home/page.tsx` — `CreateTemplateDialog` — **Missing:** Escape key, click-outside, `role="dialog"`, `aria-modal="true"`

### What's missing:
- `NewFeatureDialog` and `CreateTemplateDialog` don't close when pressing Escape
- `NewFeatureDialog` and `CreateTemplateDialog` don't close when clicking the backdrop overlay
- Neither dialog has `role="dialog"` or `aria-modal="true"` for screen readers
- This is inconsistent with `ConfirmDialog` and `PushDialog` which handle all of these

## Requirements

### 1. Update NewFeatureDialog in `src/app/workspace/[repoId]/page.tsx`

**Add Escape key handler** — Follow the exact pattern from `ConfirmDialog`:

```tsx
useEffect(() => {
  if (!open) return;
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [open, onClose]);
```

Add this inside the `NewFeatureDialog` component, after the existing `useEffect` hooks (after line 50).

**Add click-outside dismiss and ARIA attributes** — Update the outer overlay `<div>` (line 57):

Before:
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
```

After:
```tsx
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
  onClick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  role="dialog"
  aria-modal="true"
>
```

### 2. Update CreateTemplateDialog in `src/app/(dashboard)/home/page.tsx`

**Add Escape key handler** — Same pattern. Find the `CreateTemplateDialog` component and add:

```tsx
useEffect(() => {
  if (!open) return;
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [open, onClose]);
```

Make sure `useEffect` is imported (it should already be imported since the component uses it).

**Add click-outside dismiss and ARIA attributes** — Update the outer overlay `<div>` (around line 503):

Before:
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in">
```

After:
```tsx
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
  onClick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  role="dialog"
  aria-modal="true"
>
```

### 3. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open the workspace, trigger NewFeatureDialog:
  - Press Escape → dialog should close
  - Click the dark backdrop → dialog should close
  - Click inside the dialog → dialog should NOT close
- Open the dashboard, trigger CreateTemplateDialog:
  - Press Escape → dialog should close
  - Click the dark backdrop → dialog should close
  - Click inside the dialog → dialog should NOT close
- Verify that ConfirmDialog and PushDialog still work correctly (no regressions)

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Add Escape key `useEffect`, click-outside handler, `role="dialog"`, `aria-modal="true"` to `NewFeatureDialog` |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add Escape key `useEffect`, click-outside handler, `role="dialog"`, `aria-modal="true"` to `CreateTemplateDialog` |

## Acceptance Criteria

1. Pressing Escape closes the `NewFeatureDialog`
2. Pressing Escape closes the `CreateTemplateDialog`
3. Clicking the backdrop overlay closes both dialogs
4. Clicking inside the dialog content does NOT close either dialog
5. Both dialogs have `role="dialog"` and `aria-modal="true"` attributes
6. The pattern matches exactly what `ConfirmDialog` uses (Escape handler + `e.target === e.currentTarget` click check)
7. No regressions to existing dialog behavior
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `e.target === e.currentTarget` check is the standard pattern for "click outside" in React — it only fires when the click is directly on the overlay div, not when it bubbles up from a child element (the dialog panel).
- The Escape key handler uses `document.addEventListener` and cleans up on unmount. It's the same pattern used by `ConfirmDialog` (line 32-36) and `PushDialog` (line 84-89).
- Both dialogs already have `onClose` props, so no new props are needed.
- The `CreateTemplateDialog` should NOT close on Escape/click-outside while `creatingProject` is true (during the async creation). Add a guard: `if (e.key === "Escape" && !creatingProject) onClose()`. Similarly for click-outside.
- The `NewFeatureDialog` has no async state, so no guard is needed — Escape/click-outside always works.
- This is a ~15-line change per dialog. Two files, no backend changes.
