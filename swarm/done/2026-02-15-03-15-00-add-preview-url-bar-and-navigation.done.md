# Task: Add Preview URL Bar with Navigation Controls

## Context

When the WebContainer dev server is running and the user sees a live preview in the iframe, there is no URL bar or navigation controls. The user can't see what page they're viewing, navigate to a different route, or refresh the preview. This is critical UX for previewing multi-page applications — non-technical users need familiar browser-like controls to navigate within their preview.

### What exists now:
- `src/components/preview/PreviewPanel.tsx` — Shows an `<iframe>` with `src={previewUrl}` when `phase === "running"`. There's a status bar at the bottom that shows "Running on {previewUrl}" but no interactive controls.
- The iframe's `src` is set once from `previewUrl` (returned by `useWorkspaceContainer`), and never updated after initial load.
- There are no back/forward/refresh buttons.

### What's missing:
- No URL bar showing the current iframe URL
- No way for the user to type a path (e.g., `/about`) to navigate within the preview
- No Refresh button to reload the preview iframe
- No back/forward buttons

## Requirements

### 1. Create `src/components/preview/PreviewNavBar.tsx`

A browser-like navigation bar that sits between the tab bar and the iframe content.

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  ← → ↻  │  http://localhost:3000/about              ↗  │
└──────────────────────────────────────────────────────────┘
```

**Components:**
- **Back button** (←): Calls `history.back()` on the iframe's `contentWindow` (disabled when can't go back)
- **Forward button** (→): Calls `history.forward()` on the iframe's `contentWindow` (disabled when can't go forward)
- **Refresh button** (↻): Reloads the iframe by setting `src` to current URL
- **URL input**: Shows the current preview URL; user can edit and press Enter to navigate
- **Open in new tab** (↗): Opens the current preview URL in a new browser tab

**Props:**
```tsx
interface PreviewNavBarProps {
  previewUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}
```

**Behavior:**
- Display the current `previewUrl` in the URL input
- When the user types a path and presses Enter, update the iframe `src` to navigate
- The refresh button resets `iframe.src` to reload the content
- Back/forward buttons try to use `iframe.contentWindow.history` but may be restricted by cross-origin policies — in that case, just hide them or keep them disabled
- Open in new tab uses `window.open(previewUrl, '_blank')`

**Styling:**
- Dark theme: zinc-900 background, zinc-700 border
- Small, compact bar (py-1.5) so it doesn't take too much vertical space
- Monospace font for the URL input (text-xs)
- Icon buttons for nav controls with hover states

### 2. Update `src/components/preview/PreviewPanel.tsx`

- Add a `ref` to the iframe element using `useRef<HTMLIFrameElement>(null)`
- When `view === "preview"` and `isRunning && previewUrl`, render `<PreviewNavBar>` above the iframe
- Track the current URL in state (`currentUrl`) — initialize from `previewUrl`, update when user navigates
- Pass `iframeRef` and `currentUrl` to `PreviewNavBar`
- The iframe `src` should use `currentUrl` instead of `previewUrl` directly, so user navigation persists

### 3. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/preview/PreviewNavBar.tsx` | **Create** | Browser-like URL bar with back/forward/refresh/open-in-tab controls |
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Add iframe ref, current URL state, render PreviewNavBar above iframe |

## Acceptance Criteria

1. When the preview is running, a URL bar appears between the tab bar and the iframe
2. The URL bar displays the current preview URL
3. The user can edit the URL and press Enter to navigate the iframe to a different path
4. The Refresh button reloads the iframe
5. The "Open in new tab" button opens the preview URL in a new tab
6. Back/forward buttons are present (disabled if cross-origin restrictions prevent use)
7. The URL bar is compact and doesn't take much vertical space
8. The URL bar disappears when the preview is not running (loading/error/idle states)
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- WebContainer preview URLs are typically `http://localhost:{port}` — cross-origin iframe restrictions may prevent `contentWindow.history` access. That's OK — disable those buttons gracefully.
- The iframe ref needs `React.RefObject<HTMLIFrameElement | null>` typing
- Use `key` prop on iframe to force full reload when URL changes significantly (e.g., different base URL), but for same-origin path changes just update `src`
- Keep the URL input as a controlled input with local state for typing, committing on Enter
- Use inline SVG icons for the nav buttons to avoid adding icon library dependencies
- The current URL bar and nav controls should be a client component (`"use client"`)

## Completion Summary

### Files Created
- `src/components/preview/PreviewNavBar.tsx` — Browser-like navigation bar with back/forward/refresh buttons, editable URL input, and open-in-new-tab button. Uses inline SVG icons, dark zinc-900 theme, compact layout (py-1.5), monospace URL input. Handles cross-origin iframe history access gracefully with try/catch. Supports relative path input (e.g. `/about` resolves against the base preview URL).

### Files Modified
- `src/components/preview/PreviewPanel.tsx` — Added iframe ref (`useRef<HTMLIFrameElement>`), `currentUrl` state (synced from `previewUrl` on first availability), imported and rendered `<PreviewNavBar>` above the iframe when preview is running. The iframe now uses `currentUrl` as its `src` so user navigation persists. The `onNavigate` callback updates `currentUrl` state when user enters a new URL.

### Verification
- `npx tsc -p tsconfig.json --noEmit` passes with no errors
- `npm run build` completes successfully
- All acceptance criteria met

## Review (159de4f7)

**Reviewed all 2 files (1 created, 1 modified). No issues found.**

Checks performed:
- `src/components/preview/PreviewNavBar.tsx` — `"use client"` directive present (required — uses `useState`). Props interface correctly typed with `React.RefObject<HTMLIFrameElement | null>`. State sync pattern (`lastPreviewUrl` comparison) is the correct React pattern for derived state from props without `useEffect`. URL resolution for relative paths (e.g. `/about`) correctly uses `new URL()` with try/catch fallback. Cross-origin iframe `contentWindow.history` access wrapped in try/catch (silently ignores SecurityError). SVG icons are inline (no icon library dependency). `handleRefresh` correctly resets and re-sets `src` to force reload.
- `src/components/preview/PreviewPanel.tsx` — `"use client"` directive present. `iframeRef` correctly typed as `useRef<HTMLIFrameElement>(null)`. `currentUrl` state syncing is properly guarded (`if (!currentUrl)`) to only set on first `previewUrl` availability — subsequent navigation by user is preserved. `PreviewNavBar` receives `currentUrl` (not `previewUrl`) so the URL input reflects user navigation. `onNavigate={setCurrentUrl}` correctly updates state when user enters a URL. `sessionId` in props interface is unused in destructuring — acceptable since it's passed from workspace page and may be used in future.
- `npm -s tsc -p tsconfig.json --noEmit` — passes with zero errors
- `npm -s convex codegen` — passes
- No fixes needed — all code is clean
