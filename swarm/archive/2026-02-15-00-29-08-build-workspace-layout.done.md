# Task: Build Workspace Layout Shell (Split-Pane with Header, Chat Panel, Preview Panel)

## Context

The Convex schema is complete with all 7 tables. The app currently shows a simple placeholder page at `/`. No layout components, workspace pages, or UI structure exist yet. This task builds the core visual shell of the application — the workspace layout that users will interact with. This is the foundation that chat and preview features will plug into.

The workspace layout is the primary screen of the app (the `/(workspace)/[repoId]/page.tsx` route from the plan), but for now we'll build it as the main page (`/`) since auth and routing aren't set up yet. We can relocate it later.

## Requirements

### 1. Create `src/components/layout/Header.tsx`

A top bar component for the workspace:
- Fixed to the top of the viewport, full width
- Left side: "Artie" logo/text (simple text, styled bold)
- Center: Repo name placeholder (show "my-project" as hardcoded text for now)
- Right side: User avatar placeholder (a simple circle with initials "U")
- Height: ~48px
- Styling: dark background (`bg-zinc-900`), white text, subtle bottom border
- Use `"use client"` directive

### 2. Create `src/components/layout/SplitPane.tsx`

A horizontally-split resizable panel component:
- Takes `left` and `right` ReactNode props for the two panels
- Left panel: default width ~35% of viewport, min-width 300px, max-width 60%
- Right panel: fills remaining space
- A draggable divider (4px wide, visible on hover) between panels to resize
- Implement drag resize using mouse events (mousedown on divider, mousemove to resize, mouseup to stop)
- Both panels should scroll independently (overflow-y: auto)
- Full height (fills parent, which should be viewport minus header)
- Use `"use client"` directive

### 3. Create `src/components/chat/ChatPanel.tsx`

A placeholder chat panel component:
- Full height flex column layout
- Top section: Scrollable message area (for now, show an empty state message: "Start a conversation to preview and edit your code")
- Bottom section: A text input with a send button (non-functional for now)
  - Input: full width, placeholder text "Describe what you'd like to change..."
  - Send button: right-aligned, with an arrow/send icon (use a simple SVG arrow or the text "Send")
  - Styled with a border-top separator
- Use `"use client"` directive

### 4. Create `src/components/preview/PreviewPanel.tsx`

A placeholder preview panel component:
- Full height flex column layout
- Main area: Empty state showing "Connect a repository to see a live preview" centered, with a subtle icon or illustration (can just be text)
- Bottom: A status bar showing "No preview available" in muted text
- Background slightly different from chat panel to visually distinguish (e.g., `bg-zinc-100 dark:bg-zinc-950`)
- Use `"use client"` directive

### 5. Update `src/app/page.tsx`

Replace the current placeholder with the workspace layout:
- Import and render `Header` at the top
- Below the header, render `SplitPane` with `ChatPanel` as left and `PreviewPanel` as right
- The layout should fill the full viewport height (`h-screen` with flex column)
- Mark as `"use client"`

### 6. Update `src/app/globals.css`

Ensure the CSS supports the layout:
- Keep existing Tailwind import and theme variables
- Ensure `html, body` have `height: 100%` and `margin: 0` so the full-height layout works
- Add any CSS custom properties needed for the split pane (e.g., `--header-height: 48px`)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/Header.tsx` | **Create** | Top bar with logo, repo name, user avatar |
| `src/components/layout/SplitPane.tsx` | **Create** | Resizable split-pane container |
| `src/components/chat/ChatPanel.tsx` | **Create** | Chat panel with empty state and input |
| `src/components/preview/PreviewPanel.tsx` | **Create** | Preview panel with empty state and status bar |
| `src/app/page.tsx` | **Modify** | Compose the workspace layout |
| `src/app/globals.css` | **Modify** | Ensure full-height layout support |

## Acceptance Criteria

1. The app renders a full-viewport workspace layout with header, left chat panel, and right preview panel
2. The split pane divider can be dragged to resize the two panels
3. The chat panel shows an empty state message and a text input with send button at the bottom
4. The preview panel shows a "no preview" empty state with a status bar at the bottom
5. The header shows "Artie" on the left, a repo name placeholder in the center, and a user avatar placeholder on the right
6. Dark mode is supported (respects `prefers-color-scheme` or Tailwind dark classes)
7. `npx convex codegen` still succeeds
8. `npx tsc -p tsconfig.json --noEmit` passes with no errors
9. The app runs without errors (`npm run dev`)

## Tech Notes

- Use Tailwind CSS 4 utility classes for all styling — no separate CSS modules needed
- Use React 19 — no need for `useCallback`/`useMemo` wrappers (automatic memoization)
- For the SplitPane drag behavior, use `useRef` for the container ref and `useState` for the left panel width. Attach `mousemove` and `mouseup` listeners to `document` during drag to handle mouse leaving the divider area.
- Use `"use client"` on all interactive components (Header, SplitPane, ChatPanel, PreviewPanel)
- Import paths should use `@/` prefix (e.g., `@/components/layout/Header`)
- Keep components simple — no Convex data fetching yet, just UI structure
- The send button and input don't need to be functional — just visually present

---

## Completion Summary

### Files Created
- `src/components/layout/Header.tsx` — Top bar with "Artie" logo, centered repo name placeholder ("my-project"), and user avatar circle. Dark background (`bg-zinc-900`), 48px height, bottom border.
- `src/components/layout/SplitPane.tsx` — Horizontally-split resizable panel. Left panel defaults to 35% width (min 300px, max 60%). Draggable divider with hover highlight. Uses `useRef` for drag state and `useEffect` for document-level mouse listeners. Both panels scroll independently.
- `src/components/chat/ChatPanel.tsx` — Full-height flex column with centered empty-state message, bottom input area with text field and SVG send button icon. Styled with border-top separator.
- `src/components/preview/PreviewPanel.tsx` — Full-height flex column with centered empty-state message and icon, bottom status bar showing "No preview available". Slightly different background (`bg-zinc-100 dark:bg-zinc-950`).

### Files Modified
- `src/app/page.tsx` — Replaced placeholder with workspace layout composing Header, SplitPane, ChatPanel, and PreviewPanel. Full viewport height with `h-screen` flex column. Marked `"use client"`.
- `src/app/globals.css` — Added `html` selector and `height: 100%; margin: 0;` to ensure full-height layout works.

### Verification
- `npx convex codegen` — passes
- `npx tsc -p tsconfig.json --noEmit` — passes with no errors

### Notes for Future Tasks
- All components use `"use client"` and are ready for Convex data fetching hooks to be added
- The ChatPanel input state is managed but the send button is non-functional — wire up to Convex mutations when chat backend is ready
- The Header repo name and user avatar are hardcoded — replace with dynamic data from Convex queries when auth/routing is implemented
- The SplitPane can be relocated to the `/(workspace)/[repoId]/page.tsx` route when auth and routing are set up
