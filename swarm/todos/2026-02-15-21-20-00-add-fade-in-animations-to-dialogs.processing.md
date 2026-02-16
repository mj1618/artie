# Task: Add Fade-In/Scale Animations to All Dialogs

## Context

Phase 7 (Polish & Launch) includes "Loading states and animations." All four dialog/modal components in the app appear instantly with no transition — they snap onto the screen when opened. This feels jarring and unpolished, especially for non-technical users who expect smooth, professional UI transitions. Adding a simple fade-in for the backdrop and a scale+fade for the dialog content is a small change with a large perceived quality improvement.

### What exists now:
- `src/components/ui/ConfirmDialog.tsx` — Fixed overlay with `bg-black/60`, no animation
- `src/components/chat/PushDialog.tsx` — Four different render states, all with `bg-black/60` overlay, no animation
- `src/app/workspace/[repoId]/page.tsx` — `NewFeatureDialog` with `bg-black/50` overlay, no animation
- `src/app/(dashboard)/home/page.tsx` — Template creation dialog with `bg-black/60` overlay, no animation

### What's missing:
- No fade-in on the backdrop overlay
- No scale/fade animation on the dialog panel
- Dialogs pop in abruptly, feel unfinished

## Requirements

### 1. Add a Tailwind `animate-in` keyframe to `tailwind.config.ts`

Add custom keyframes and animation utilities for dialog entrance:

```ts
// Inside theme.extend
keyframes: {
  'fade-in': {
    '0%': { opacity: '0' },
    '100%': { opacity: '1' },
  },
  'dialog-in': {
    '0%': { opacity: '0', transform: 'scale(0.95)' },
    '100%': { opacity: '1', transform: 'scale(1)' },
  },
},
animation: {
  'fade-in': 'fade-in 150ms ease-out',
  'dialog-in': 'dialog-in 150ms ease-out',
},
```

This gives us two utilities:
- `animate-fade-in` — for the backdrop overlay
- `animate-dialog-in` — for the dialog panel (scale from 95% + fade)

### 2. Update ConfirmDialog.tsx

**Backdrop overlay (line 47):**

Change:
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
```
To:
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
```

**Dialog panel (line 54):**

Change:
```tsx
className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6"
```
To:
```tsx
className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 animate-dialog-in"
```

### 3. Update PushDialog.tsx

PushDialog has four render states (success, loading, error, form). Add animations to all of them.

For every `<div className="fixed inset-0 z-50 ...">` overlay (there are 4 instances), add `animate-fade-in`.

For every dialog panel (`<div className="w-full max-w-lg rounded-lg border ...">` inside the overlay), add `animate-dialog-in`.

The key instances:
- **Success state** (line 147): overlay + panel
- **Loading state** (line 220): overlay + panel
- **Repo null state** (line 236): overlay + panel
- **Main form** (line 258/267): overlay + panel

### 4. Update NewFeatureDialog in workspace page

In `src/app/workspace/[repoId]/page.tsx`, the `NewFeatureDialog` component:

**Backdrop (around line 57):**
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
```
→ Add `animate-fade-in`

**Panel (around line 58):**
```tsx
className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
```
→ Add `animate-dialog-in`

### 5. Update template creation dialog in home page

In `src/app/(dashboard)/home/page.tsx`, the template creation dialog:

**Backdrop (around line 503):**
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
```
→ Add `animate-fade-in`

**Panel (around line 504):**
```tsx
className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6"
```
→ Add `animate-dialog-in`

### 6. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open the workspace and trigger NewFeatureDialog — should fade in smoothly
- Open ConfirmDialog (e.g., delete a session) — should fade in smoothly
- Open PushDialog — should fade in smoothly
- Verify animations are quick (150ms) and not distracting

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `tailwind.config.ts` | **Modify** | Add `fade-in` and `dialog-in` keyframes + animation utilities |
| `src/components/ui/ConfirmDialog.tsx` | **Modify** | Add `animate-fade-in` to overlay, `animate-dialog-in` to panel |
| `src/components/chat/PushDialog.tsx` | **Modify** | Add `animate-fade-in` to all 4 overlay instances, `animate-dialog-in` to all 4 panel instances |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Add animations to NewFeatureDialog overlay + panel |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add animations to template creation dialog overlay + panel |

## Acceptance Criteria

1. All 4 dialog/modal components have a fade-in animation on the backdrop overlay
2. All dialog panels have a subtle scale+fade entrance animation (95% → 100% scale + opacity)
3. Animations are 150ms with `ease-out` timing — fast enough to feel responsive, slow enough to feel smooth
4. The `tailwind.config.ts` defines reusable `animate-fade-in` and `animate-dialog-in` utilities
5. No animation on close (exit animations require additional complexity and aren't needed for MVP)
6. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Only add entrance animations — exit animations require `AnimatePresence`-style libraries or keeping the component mounted during exit, which is significantly more complex. Entrance-only animations deliver 80% of the perceived quality improvement with 20% of the effort.
- 150ms is the sweet spot — fast enough that the UI doesn't feel laggy, slow enough that the animation is perceptible. Below 100ms the animation is invisible; above 200ms it feels sluggish.
- `scale(0.95)` is subtle enough to add depth without being distracting. It matches the pattern used by Tailwind UI and Headless UI.
- Check if `tailwind.config.ts` already has `theme.extend.keyframes` — if so, merge into the existing object rather than replacing it.
- The `animate-spin` utility is already used in several places (loading spinners), so Tailwind animations are already working in the project.
