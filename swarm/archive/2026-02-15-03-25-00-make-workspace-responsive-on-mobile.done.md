# Task: Make Workspace Responsive on Mobile / Tablet

## Context

The workspace page (`/workspace/[repoId]`) uses a `SplitPane` component that relies entirely on mouse-based dragging and percentage widths. On mobile and tablet screens, this layout is completely unusable — the chat panel and preview panel are squeezed side-by-side with no way to resize (no touch support for the drag divider), and both panels are too narrow to be useful.

The PLAN.md lists "Mobile-responsive (though primary use is desktop)" as a design principle. While the landing page, dashboard, and settings pages use responsive layouts (max-width containers, stacking), the workspace — the core experience — has zero mobile support.

### What exists now:
- `src/components/layout/SplitPane.tsx` — Uses `leftWidth` percentage state, mouse events for drag resizing, side-by-side flex layout. No touch events, no breakpoint handling.
- `src/app/workspace/[repoId]/page.tsx` — Renders `<Header>` + `<SplitPane left={<ChatPanel>} right={<PreviewPanel>} />`
- The workspace fills the full viewport height (`h-screen flex flex-col`)

### What's missing:
- On screens < 768px, the side-by-side layout should collapse to a stacked/tabbed layout
- Users should be able to switch between Chat and Preview via tabs on mobile
- The drag divider should be hidden on mobile

## Requirements

### 1. Update `src/components/layout/SplitPane.tsx` to support mobile breakpoints

Add responsive behavior:

**Desktop (≥768px):** Keep the current side-by-side resizable layout — no changes.

**Mobile (<768px):** Switch to a full-width tabbed layout:
- Show two tab buttons at the top: "Chat" and "Preview"
- Only render the active tab's content at full width
- No drag divider
- Default to showing the "Chat" tab

**Implementation approach:**
- Use a `useMediaQuery` or `useIsMobile` hook (or a simple `useState` + `useEffect` + `window.matchMedia`) to detect screen width
- When mobile, render tabs + single panel instead of the side-by-side layout
- When desktop, render the existing side-by-side layout unchanged

```tsx
const [isMobile, setIsMobile] = useState(false);
const [activeTab, setActiveTab] = useState<"left" | "right">("left");

useEffect(() => {
  const mq = window.matchMedia("(max-width: 767px)");
  setIsMobile(mq.matches);
  const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, []);
```

### 2. Tab UI for mobile

When `isMobile` is true, render:

```
┌─────────────────────────────────┐
│  [Chat]  [Preview]              │  ← Tab bar
├─────────────────────────────────┤
│                                 │
│    Full-width active panel      │
│                                 │
└─────────────────────────────────┘
```

- Tab bar: Use the same styling pattern as the PreviewPanel's tab bar (Preview/Code/Terminal) — small rounded buttons with active/inactive states
- Active tab content fills the remaining vertical space
- Both `left` and `right` children should remain mounted (use `hidden` class or conditional display) so chat messages and preview state aren't lost when switching tabs

### 3. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/SplitPane.tsx` | **Modify** | Add mobile breakpoint detection, render tabbed layout on mobile, keep existing desktop layout |

## Acceptance Criteria

1. On desktop screens (≥768px), the workspace behaves exactly as before — side-by-side resizable panels
2. On mobile screens (<768px), the workspace shows a tab bar with "Chat" and "Preview" tabs
3. Only the active tab's content is visible on mobile, taking full width
4. Switching tabs preserves state (messages don't reload, preview doesn't restart)
5. The divider handle is not shown on mobile
6. The default active tab on mobile is "Chat"
7. Resizing the browser window from mobile to desktop (and vice versa) transitions smoothly
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `window.matchMedia` rather than resize event listeners — it's more efficient and specifically designed for breakpoint detection
- Keep both children mounted using CSS `hidden` / `display: none` to avoid losing WebContainer state when switching tabs
- The 768px breakpoint matches Tailwind's `md:` breakpoint
- Don't add touch support to the drag divider — it's simpler to just switch to the tabbed layout on touch devices
- The `SplitPane` component receives generic `left` and `right` ReactNode props, so the tab labels ("Chat" and "Preview") should be added as optional props with defaults: `leftLabel?: string` and `rightLabel?: string`

---

## Completion Summary

### Agent: 28f0b80b

### What was built
Added mobile-responsive tabbed layout to the workspace's `SplitPane` component. On screens narrower than 768px, the side-by-side resizable panels collapse into a tabbed interface with "Chat" and "Preview" tabs. The desktop layout remains unchanged.

### Key implementation details
- Used `window.matchMedia("(max-width: 767px)")` for efficient breakpoint detection
- Mobile tab bar uses the same styling pattern as PreviewPanel's tab bar (rounded buttons with active/inactive states)
- Both panels remain mounted using the `hidden` CSS class to preserve state (chat messages, WebContainer preview) when switching tabs
- Default active tab on mobile is "Chat"
- Added optional `leftLabel` and `rightLabel` props (defaulting to "Chat" and "Preview")
- Transitions smoothly between mobile and desktop when resizing the browser window

### Files changed
| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/SplitPane.tsx` | Modified | Added `isMobile` state via `window.matchMedia`, `activeTab` state, mobile tabbed layout with `hidden` class for inactive panels, optional `leftLabel`/`rightLabel` props |

### Verification
- `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
- Next.js production build succeeds
- Browser tested with playwright-cli (app requires Convex backend for full rendering; confirmed build serves correctly)

## Review (a3b2bd4f)

**Reviewed `src/components/layout/SplitPane.tsx`. No issues found.**

Checks performed:
- `"use client"` directive present (required — uses hooks, refs, state, effects)
- `isMobile` state correctly initialized via `window.matchMedia("(max-width: 767px)")` with proper cleanup
- `activeTab` state defaults to `"left"` (Chat) as specified
- Mobile layout: tab bar buttons with correct active/inactive styling, both panels remain mounted using `hidden` CSS class to preserve WebContainer and chat state
- Desktop layout: unchanged side-by-side resizable panels with drag divider
- Mouse event listeners for drag resizing properly cleaned up in useEffect return
- `leftLabel`/`rightLabel` optional props with correct defaults ("Chat"/"Preview")
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed
