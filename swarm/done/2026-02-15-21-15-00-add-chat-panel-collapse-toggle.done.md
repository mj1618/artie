# Task: Add Collapse/Expand Toggle for Chat Panel

## Context

Phase 7 (Polish & Launch) includes "User feedback and notifications" and "Performance optimization." The workspace page has a resizable `SplitPane` with the chat on the left and preview on the right. On desktop, users cannot hide the chat panel to maximize preview space — the left pane has a 300px minimum width enforced in the drag handler. Users reviewing a live preview or doing visual QA don't need the chat panel taking up 35% of screen width.

Mobile already has tab switching (Chat vs Preview), but desktop has no equivalent way to focus on one pane.

### What exists now:
- `src/components/layout/SplitPane.tsx` — Resizable split pane with `leftWidth` state (default 35%), min 300px, max 60%
- The divider is a 4px wide bar (`w-1`) with `cursor-col-resize` and hover highlight
- Mobile mode has Chat/Preview tab switcher
- No collapse/expand functionality on desktop

### What's missing:
- No way to collapse the chat panel to maximize preview space
- No keyboard shortcut to toggle chat visibility
- No visual affordance (button) on the divider or panel header to collapse/expand

## Requirements

### 1. Add `collapsed` state to SplitPane

Add a `collapsed` state boolean. When collapsed, the left panel width goes to 0 and the right panel takes the full width.

```tsx
const [collapsed, setCollapsed] = useState(false);
```

### 2. Add a collapse/expand button on the divider

Replace the plain divider with one that includes a toggle button. The button should be a small chevron icon in the center of the divider:

- **When expanded**: Show a left-pointing chevron (`«`) — clicking collapses the chat
- **When collapsed**: Show a right-pointing chevron (`»`) — clicking expands the chat

The button should be a small pill/circle centered vertically on the divider bar:

```tsx
<div
  ref={dividerRef}
  onPointerDown={collapsed ? undefined : onDividerPointerDown}
  className={`group relative shrink-0 ${
    collapsed
      ? "w-1 cursor-default bg-zinc-700"
      : "w-1 cursor-col-resize bg-zinc-200 transition-colors hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-500"
  }`}
>
  <button
    onClick={() => setCollapsed(!collapsed)}
    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex h-6 w-4 items-center justify-center rounded-sm bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
    aria-label={collapsed ? "Expand chat panel" : "Collapse chat panel"}
  >
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      {collapsed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      )}
    </svg>
  </button>
</div>
```

The button is invisible by default and appears on hover over the divider area (`opacity-0 group-hover:opacity-100`). This keeps the interface clean.

### 3. Update left panel rendering when collapsed

When collapsed, set the left panel to `width: 0` with `overflow: hidden`:

```tsx
<div
  className="shrink-0 overflow-hidden"
  style={{ width: collapsed ? "0%" : `${leftWidth}%` }}
>
  {left}
</div>
```

Add `transition-[width] duration-200 ease-in-out` for a smooth collapse/expand animation:

```tsx
<div
  className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
  style={{ width: collapsed ? "0%" : `${leftWidth}%` }}
>
  {left}
</div>
```

### 4. Disable drag resize when collapsed

The `onPointerDown` handler on the divider should be disabled when collapsed so users can't drag-resize a hidden panel. (See the conditional `collapsed ? undefined : onDividerPointerDown` above.)

Also change the cursor from `col-resize` to `default` when collapsed.

### 5. Add keyboard shortcut to toggle

Add a global keyboard listener for `Cmd+B` (Mac) / `Ctrl+B` (Windows) to toggle the collapsed state. This matches the convention used by VS Code and other editors for sidebar toggle.

Add this inside the SplitPane component:

```tsx
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      e.preventDefault();
      setCollapsed(c => !c);
    }
  }
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

### 6. Only apply on desktop

The collapse functionality should only apply on desktop (when `!isMobile`). The mobile layout already has its own tab switching mechanism. The keyboard shortcut listener should also only be active on desktop.

### 7. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open the workspace page on desktop:
  - Hover over the divider — the collapse chevron button should appear
  - Click the chevron — the chat panel should smoothly collapse to 0 width
  - The divider should remain visible with an expand chevron
  - Click the expand chevron — the chat panel should smoothly restore to previous width
  - Press Cmd+B — should toggle collapsed state
  - When collapsed, dragging the divider should NOT resize
  - When expanded, dragging should work as before

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/SplitPane.tsx` | **Modify** | Add `collapsed` state, collapse/expand button on divider, keyboard shortcut, transition animation |

## Acceptance Criteria

1. A collapse button (chevron) appears when hovering over the divider bar
2. Clicking the collapse button hides the left (chat) panel with a smooth width transition
3. When collapsed, the divider shows an expand button (opposite chevron direction)
4. Clicking the expand button restores the left panel to its previous width
5. `Cmd+B` / `Ctrl+B` toggles the collapsed state
6. Dragging the divider is disabled when collapsed
7. The collapse feature only applies to desktop layout (not mobile)
8. The previous `leftWidth` value is preserved when toggling — collapsing and expanding returns to the same width
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a single-file change in `SplitPane.tsx`. ~30 lines of additions/modifications.
- Use `transition-[width]` (not `transition-all`) to only animate the width property. Animating everything would cause performance issues during drag resize.
- Disable the width transition during drag resize by conditionally applying it only when not dragging. Or simpler: apply the transition class always — during drag, the rapid state updates will override the transition naturally. Tailwind transitions use CSS which browsers handle efficiently.
- The `group` class on the divider + `group-hover:opacity-100` on the button is a standard Tailwind pattern for showing elements on parent hover.
- Don't persist collapsed state to localStorage — it's a session-level preference. When users reload the workspace, they expect the chat to be visible.
- The divider width stays at `w-1` (4px) even when collapsed. This provides enough area for the hover target to show the expand button.

## Completion Summary

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/SplitPane.tsx` | **Modified** | Added `collapsed` state, collapse/expand chevron button on divider, `Cmd+B`/`Ctrl+B` keyboard shortcut, smooth `transition-[width]` animation, `onPointerDown` stopPropagation on button to prevent divider drag conflict |

### What Was Built
- Added `collapsed` boolean state to SplitPane component
- Added a chevron button centered on the divider that toggles collapse/expand (left chevron to collapse, right chevron to expand)
- Button uses `opacity-0 group-hover:opacity-100` for clean show-on-hover behavior
- Left panel transitions smoothly between 0% and `leftWidth%` using `transition-[width] duration-200 ease-in-out`
- `Cmd+B` / `Ctrl+B` keyboard shortcut toggles collapsed state (desktop only)
- Divider drag resize disabled when collapsed (`onPointerDown` conditionally undefined)
- Cursor changes from `col-resize` to `default` when collapsed
- All collapse functionality scoped to desktop only (keyboard shortcut effect early-returns on mobile)
- Added `onPointerDown` stopPropagation on the button to prevent the parent divider's pointer capture from swallowing the click event
- Previous `leftWidth` value preserved across collapse/expand cycles
- TypeScript check passes with no errors
- Browser tested: collapse, expand, and visual layout all verified correct

## Review (98f09cdf)

Reviewed `src/components/layout/SplitPane.tsx`. Found and fixed 1 issue:

**Fixed: Missing light-mode color variants on collapsed divider and toggle button.**
The collapsed divider state used `bg-zinc-700` without a light-mode variant (the expanded state properly uses `bg-zinc-200 ... dark:bg-zinc-700`). The toggle button similarly used dark-theme-only colors (`bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200`). Fixed by adding proper light/dark color pairs:
- Collapsed divider: `bg-zinc-700` → `bg-zinc-300 dark:bg-zinc-700`
- Button bg/text: `bg-zinc-700 text-zinc-400` → `bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400`
- Button hover: `hover:bg-zinc-600 hover:text-zinc-200` → `hover:bg-zinc-400 hover:text-zinc-700 dark:hover:bg-zinc-600 dark:hover:text-zinc-200`

Everything else looks correct:
- "use client" directive present
- All imports used and valid
- Keyboard shortcut effect properly depends on `isMobile` and cleans up
- `onPointerDown` correctly disabled when collapsed
- Button `stopPropagation` prevents divider drag conflict
- Width transition scoped to `[width]` only
- `leftWidth` preserved across collapse/expand cycles
- TypeScript check (`npx tsc --noEmit`) passes clean after fixes
