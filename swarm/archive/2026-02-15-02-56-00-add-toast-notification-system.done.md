# Task: Add Toast Notification System

## Context

The application has many user actions that succeed or fail silently — creating teams, sending invites, saving settings, connecting repos, pushing to GitHub, etc. There is no toast/notification system to give the user feedback. This is a foundational polish piece (Phase 6) that every feature benefits from.

### What exists now:
- No toast or notification component anywhere in the codebase
- Success/error states are handled inline (e.g., `alert()` or just ignored)
- No central notification context or provider

### What's needed:
- A lightweight toast notification system that can be triggered from any component
- Success, error, and info toast variants
- Auto-dismiss after a few seconds
- Stacks in the bottom-right corner

## Requirements

### 1. Create `src/components/ui/Toast.tsx`

A toast notification component with:
- **Variants**: `success` (green), `error` (red), `info` (blue)
- **Layout**: Icon + message text + optional close button
- **Animation**: Slide in from right, fade out on dismiss
- **Auto-dismiss**: Default 4 seconds, configurable
- **Stacking**: Multiple toasts stack vertically (bottom-right corner)
- **Styling**: Match the existing dark theme (zinc backgrounds, subtle borders)

### 2. Create `src/lib/useToast.ts`

A React context + hook for triggering toasts from anywhere:

```typescript
// Usage in any component:
const { toast } = useToast();

toast({ type: "success", message: "Team created successfully" });
toast({ type: "error", message: "Failed to send invite" });
toast({ type: "info", message: "Changes applied to preview" });
```

**Implementation:**
- `ToastProvider` wraps the app (add to root layout)
- `useToast()` hook returns `{ toast }` function
- Provider manages toast state (array of active toasts)
- Each toast gets a unique ID and auto-removes after timeout
- Max 5 visible toasts at once (oldest dismissed first if exceeded)

### 3. Create `src/components/ui/ToastContainer.tsx`

The fixed-position container that renders active toasts:
- Position: `fixed bottom-4 right-4 z-50`
- Renders toasts in a flex column with gap
- Each toast can be manually dismissed via X button

### 4. Wire into root layout

Add `<ToastProvider>` to `src/app/layout.tsx` wrapping the app content (inside ConvexClientProvider so toasts can be used in Convex-connected components).

### 5. Add toasts to existing actions

Wire up toast notifications for key user actions across the app:

| Page/Component | Action | Toast |
|---|---|---|
| `home/page.tsx` | Create team | Success: "Team created" / Error |
| `team/[teamId]/page.tsx` | Send invite | Success: "Invite sent to {email}" / Error |
| `team/[teamId]/page.tsx` | Remove member | Success: "Member removed" / Error |
| `settings/page.tsx` | Save display name | Success: "Settings saved" / Error |
| `repos/[repoId]/settings/page.tsx` | Save repo settings | Success: "Settings saved" / Error |
| `llm-settings/page.tsx` | Save LLM config | Success: "LLM settings saved" / Error |
| `ChatPanel.tsx` | AI response error | Error: "Failed to get AI response" |
| `ChangePreview.tsx` | Approve/reject changes | Success: "Changes approved" or "Changes reverted" |

**Note**: Don't change every single action — just the most visible ones listed above. Keep the scope manageable.

### 6. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/ui/Toast.tsx` | **Create** | Individual toast component with variants |
| `src/components/ui/ToastContainer.tsx` | **Create** | Fixed-position container rendering active toasts |
| `src/lib/useToast.tsx` | **Create** | ToastProvider context + useToast hook |
| `src/app/layout.tsx` | **Modify** | Wrap app with ToastProvider |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add toasts for team creation |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add toasts for invite/member actions |
| `src/app/(dashboard)/settings/page.tsx` | **Modify** | Add toast for settings save |
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | **Modify** | Add toast for settings save |
| `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` | **Modify** | Add toast for LLM config save |

## Acceptance Criteria

1. `useToast()` hook is available from any component inside the app
2. `toast({ type: "success", message: "..." })` shows a green toast in the bottom-right
3. `toast({ type: "error", message: "..." })` shows a red toast in the bottom-right
4. Toasts auto-dismiss after ~4 seconds
5. Multiple toasts stack vertically
6. Toasts can be manually dismissed with an X button
7. Key dashboard actions (create team, send invite, save settings) show appropriate toasts
8. Toast styling matches the existing dark theme
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use React context (not a third-party library) to keep dependencies minimal
- Use `crypto.randomUUID()` for toast IDs (available in all modern browsers)
- CSS transitions via Tailwind `transition-all` and `animate-` classes for slide-in
- The ToastProvider should be inside ConvexClientProvider but that doesn't matter much — toasts are purely client-side state
- Keep the toast component simple — no markdown rendering, no actions/buttons inside toasts, just text
- Use `useCallback` for the `toast` function to keep it referentially stable (though React 19 handles this automatically)

---

## Implementation Summary

### Files Created
- `src/components/ui/Toast.tsx` — Individual toast component with success/error/info variants, icons, close button, slide-in animation
- `src/components/ui/ToastContainer.tsx` — Fixed-position container (bottom-right, z-50) that renders active toasts with flex column layout; also exports Toast/ToastType types
- `src/lib/useToast.tsx` — ToastProvider context + useToast hook, manages toast state array, auto-dismiss (4s), max 5 toasts, crypto.randomUUID() for IDs

### Files Modified
- `src/app/globals.css` — Added `@keyframes toast-slide-in` and `.animate-toast-in` CSS class
- `src/app/layout.tsx` — Wrapped app with `<ToastProvider>` inside `<ConvexClientProvider>`
- `src/app/(dashboard)/home/page.tsx` — Added toast for team creation (success/error)
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Added toasts for member removal and invite sending (success/error)
- `src/app/(dashboard)/settings/page.tsx` — Added toast for profile save (success/error)
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Added toast for repo settings save (success/error)
- `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` — Added toasts for LLM settings save and reset (success/error)
- `src/components/chat/ChatPanel.tsx` — Added toast for AI response errors
- `src/components/chat/ChangePreview.tsx` — Added toast for change revert (success/error)
- `src/components/ui/Skeleton.tsx` — Fixed missing `style` prop (pre-existing bug from another task)

### Verification
- `tsc --noEmit` passes with zero errors
- Next.js build completes successfully

### Reviewer Pass (7fbd6039, iteration 4)
- Reviewed all toast system files: Toast.tsx, ToastContainer.tsx, useToast.tsx, globals.css, layout.tsx
- Reviewed all dashboard pages with toast integration: home, team, settings, repo settings, llm-settings, ChatPanel, ChangePreview
- `"use client"` directives present on all client components (Toast.tsx, ToastContainer.tsx, useToast.tsx)
- Toast types properly defined in ToastContainer.tsx and re-exported from useToast.tsx — no circular dependency
- ToastProvider wraps app correctly inside ConvexClientProvider in layout.tsx
- Toast animation CSS (`toast-slide-in` keyframes + `.animate-toast-in` class) properly defined in globals.css
- Auto-dismiss (4s), max 5 toasts, manual dismiss, crypto.randomUUID() for IDs — all correct
- All dashboard pages import `useToast` from `@/lib/useToast` and wrap actions in try/catch with success/error toasts
- Skeleton.tsx has `style` prop — matches DashboardSkeleton.tsx usage
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with zero errors
- No fixes needed — all code is clean
