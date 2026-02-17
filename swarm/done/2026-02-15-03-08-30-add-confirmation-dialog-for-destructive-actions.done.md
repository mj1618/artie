# Task: Add Reusable Confirmation Dialog for Destructive Actions

## Context

Several destructive actions in the app have no confirmation step — clicking "Remove" on a team member immediately removes them with no way to undo. This is dangerous UX for non-technical users who might click accidentally.

The repo settings page has an inline disconnect confirmation dialog, but it's not reusable. Creating a shared `ConfirmDialog` component and wiring it to all destructive actions ensures consistent behavior across the app.

### What exists now:
- `src/app/(dashboard)/team/[teamId]/page.tsx` — "Remove" button on team members calls `removeMember` immediately with no confirmation
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Has an inline confirmation dialog for disconnecting a repo (uses `showDisconnect` state + a hardcoded modal)
- No reusable dialog/modal component anywhere in the codebase (`src/components/ui/` has Skeleton, Toast, ToastContainer)

### What's missing:
- No reusable `ConfirmDialog` component
- Remove member has no confirmation
- Delete session has no confirmation (if exposed in SessionPicker)
- The inline disconnect dialog in repo settings could be refactored to use the shared component

## Requirements

### 1. Create `src/components/ui/ConfirmDialog.tsx`

A reusable confirmation dialog (modal) component:

```tsx
interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;    // default: "Confirm"
  cancelLabel?: string;     // default: "Cancel"
  variant?: "danger" | "default"; // "danger" = red confirm button
  loading?: boolean;        // disables buttons + shows loading state on confirm
}
```

**UI:**
- Fixed overlay (`bg-black/60`) with centered card
- Dark theme matching existing app (zinc-900 card, zinc-800 border)
- Title + description text
- Two buttons: Cancel (ghost style) and Confirm (solid, red for danger variant)
- Close on Escape key press
- Close when clicking the overlay backdrop
- Focus trap: auto-focus the Cancel button on open (safer default than focusing Confirm)
- `loading` prop disables both buttons and shows spinner on Confirm

### 2. Wire to team member removal

In `src/app/(dashboard)/team/[teamId]/page.tsx`:
- Replace the instant `handleRemove` call with a two-step flow:
  1. Clicking "Remove" opens the ConfirmDialog with title "Remove member" and description "Are you sure you want to remove {memberName} from this team?"
  2. Confirming the dialog triggers the actual `removeMember` mutation
- Use `variant="danger"` and `confirmLabel="Remove"`

### 3. Refactor repo disconnect to use ConfirmDialog

In `src/app/(dashboard)/repos/[repoId]/settings/page.tsx`:
- Replace the inline `showDisconnect` modal with `<ConfirmDialog>` using the same title/description text
- This removes ~30 lines of inline modal code and keeps things consistent

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/ui/ConfirmDialog.tsx` | **Create** | Reusable confirmation dialog component |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add confirm dialog for member removal |
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | **Modify** | Refactor inline disconnect dialog to use ConfirmDialog |

## Acceptance Criteria

1. `ConfirmDialog` renders a dark-themed modal overlay with title, description, Cancel, and Confirm buttons
2. `variant="danger"` makes the Confirm button red
3. `loading` prop disables buttons and shows loading indicator on Confirm
4. Dialog closes on Escape key and backdrop click
5. Removing a team member shows "Remove member" confirmation dialog before executing
6. Repo disconnect uses the new ConfirmDialog (same behavior as before, but using the shared component)
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Must be a client component (`"use client"`)
- Use `useEffect` for Escape key listener (add on open, remove on close)
- Use `role="dialog"` and `aria-modal="true"` for basic accessibility
- Auto-focus Cancel button via `autoFocus` on the Cancel button element
- Keep it simple — no portal needed since it uses `fixed` positioning
- Don't use any external modal/dialog library
- The `loading` state is passed from the parent, not managed internally — the parent controls the async action lifecycle

---

## Completion Summary

### Files Created
- `src/components/ui/ConfirmDialog.tsx` — Reusable confirmation dialog component with `open`, `onClose`, `onConfirm`, `title`, `description`, `confirmLabel`, `cancelLabel`, `variant` (danger/default), and `loading` props. Dark-themed modal with overlay, Escape key close, backdrop click close, auto-focus on Cancel button, spinner on loading, and `role="dialog"` + `aria-modal="true"` accessibility attributes.

### Files Modified
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Added `ConfirmDialog` import and `confirmMember` state to `MembersList`. Clicking "Remove" now opens the confirm dialog with "Remove member" title and member name in description. Confirming triggers the actual `removeMember` mutation with loading state.
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Replaced ~30 lines of inline disconnect confirmation modal with `<ConfirmDialog>` using the same title/description text. Added `ConfirmDialog` import.

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with no errors
- `npm run build` — successful production build
- Browser tested with playwright-cli — app loads, pages render correctly

## Review (reviewer agent 6d252934)

### Issues Found & Fixed

1. **Conflicting Tailwind text color classes in ConfirmDialog default variant** (`src/components/ui/ConfirmDialog.tsx`):
   - The confirm button had `text-white` in the base classes and `text-zinc-900` in the default variant branch. With Tailwind, conflicting utility classes don't reliably resolve based on source order — the CSS specificity depends on the generated stylesheet order. This could cause the default variant button to show white text on a light (`bg-zinc-100`) background, making it unreadable.
   - **Fix**: Moved `text-white` from the base classes into the `danger` variant branch, so each variant now specifies its own text color without conflicts.

### Verified

- All imports resolve correctly (`@/lib/useToast`, `@/components/ui/ConfirmDialog`, `@/components/ui/DashboardSkeleton`)
- Convex mutation argument shapes match backend signatures (`removeMember({ teamId, memberId })`, `removeRepo({ repoId })`)
- `"use client"` directive present on all three files
- Loading/error states handled properly in both pages
- `npm -s tsc -p tsconfig.json --noEmit` — passes
- `npx convex dev --once` — passes
