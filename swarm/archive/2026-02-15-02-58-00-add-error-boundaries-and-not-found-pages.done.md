# Task: Add Error Boundaries and Not-Found Pages

## Context

The app has no error boundaries or not-found pages. If any React component throws during rendering, the entire page crashes with an unrecoverable white screen. If a user navigates to a non-existent URL (e.g., `/dashboard/nonexistent` or `/workspace/invalid-id`), they see nothing useful.

Next.js App Router has built-in support for `error.tsx` and `not-found.tsx` files that handle these cases gracefully. This is a foundational reliability piece from Phase 6 (Error handling and edge cases) that every page benefits from.

### What exists now:
- No `error.tsx` files anywhere in the app
- No `not-found.tsx` files anywhere in the app
- No `global-error.tsx` at the root level
- No React error boundary components
- Dashboard layout has auth guards and loading spinners, but no error recovery
- Workspace page has WebContainer error handling (phase-based), but no component-level error boundary

### What's missing:
- Global error boundary (`src/app/global-error.tsx`) — catches errors in the root layout
- Dashboard error boundary (`src/app/(dashboard)/error.tsx`) — catches errors in any dashboard page
- Workspace error boundary (`src/app/workspace/[repoId]/error.tsx`) — catches errors in workspace
- Root not-found page (`src/app/not-found.tsx`) — custom 404 page
- Better handling when a repoId or teamId in the URL doesn't match a real record

## Requirements

### 1. Create `src/app/global-error.tsx`

The root-level error boundary. This catches errors that occur even in the root layout. It must include its own `<html>` and `<body>` tags since the root layout may have failed.

```tsx
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="bg-zinc-950 text-white">
        {/* Full-screen error display with "Try again" button */}
      </body>
    </html>
  );
}
```

**UI:**
- Dark background matching the app theme
- Centered content: error icon, "Something went wrong" heading, error message (not stack trace), "Try again" button that calls `reset()`
- "Go home" link that navigates to `/`

### 2. Create `src/app/(dashboard)/error.tsx`

Catches errors in any dashboard page (home, team, settings, repos). Since the dashboard layout (Header + Sidebar) will still render, this just fills the main content area.

```tsx
"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Render an error message with "Try again" and "Go home" buttons
  // Style to fit within the dashboard main content area
}
```

**UI:**
- Centered in the main content area (sidebar still visible)
- Warning icon, "Something went wrong" text, error message
- "Try again" button (calls `reset()`) and "Go to dashboard" link

### 3. Create `src/app/workspace/[repoId]/error.tsx`

Catches errors in the workspace page. The workspace has no sidebar, so this is full-screen minus the header.

**UI:**
- Full-width centered error display
- "Try again" button and "Back to dashboard" link

### 4. Create `src/app/not-found.tsx`

Custom 404 page for any unmatched routes.

**UI:**
- Dark background, centered content
- Large "404" heading
- "Page not found" subheading
- "Go home" link to `/` and "Go to dashboard" link to `/home`
- Match the existing dark theme (zinc-950 background, white text)

### 5. Add not-found handling for invalid IDs in workspace and team pages

In the workspace page (`src/app/workspace/[repoId]/page.tsx`) and team page (`src/app/(dashboard)/team/[teamId]/page.tsx`), when the queried repo/team returns `null` (invalid ID), show a "not found" state instead of crashing or showing a blank page.

For workspace page:
- If `repo` query returns null after loading, show "Repository not found" with a link back to dashboard

For team page:
- If `team` query returns null after loading, show "Team not found" with a link back to dashboard

**Note:** Don't call `notFound()` from Next.js since these are client components. Instead, render an inline not-found UI when the data is null.

### 6. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/global-error.tsx` | **Create** | Root-level error boundary with full HTML shell |
| `src/app/(dashboard)/error.tsx` | **Create** | Dashboard error boundary for main content area |
| `src/app/workspace/[repoId]/error.tsx` | **Create** | Workspace error boundary |
| `src/app/not-found.tsx` | **Create** | Custom 404 page |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Add null-check for repo query, show "not found" UI |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add null-check for team query, show "not found" UI |

## Acceptance Criteria

1. `global-error.tsx` renders a styled error page with "Try again" button when the root layout throws
2. `(dashboard)/error.tsx` renders an error state within the dashboard layout (sidebar still visible)
3. `workspace/[repoId]/error.tsx` renders an error state for workspace crashes
4. `not-found.tsx` shows a custom 404 page at any unmatched URL
5. Workspace page shows "Repository not found" when repoId doesn't match a record
6. Team page shows "Team not found" when teamId doesn't match a record
7. All error pages match the existing dark theme (zinc-950 background, white/zinc text)
8. All error pages have a "Try again" or "Go home" escape hatch
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Next.js `error.tsx` files must be client components (`"use client"`) — they use React's error boundary under the hood
- `global-error.tsx` must include `<html>` and `<body>` since it replaces the root layout
- Regular `error.tsx` files render inside the parent layout, so the dashboard sidebar/header remain visible
- Don't log the full error stack to the user — just show `error.message` or a generic message
- The `reset()` function re-renders the error boundary's children, which is usually enough to recover from transient errors
- The `digest` property on errors is a hash used by Next.js for server-side errors — it's safe to ignore in the UI
- Keep styling consistent: use the same zinc-950 backgrounds, white headings, zinc-400 body text, and blue link colors used elsewhere in the app

---

## Completion Summary

### Files Created
- `src/app/global-error.tsx` — Root-level error boundary with full `<html>`/`<body>` shell, red error icon, "Something went wrong" heading, error message, "Try again" button, and "Go home" link
- `src/app/(dashboard)/error.tsx` — Dashboard error boundary that renders within the sidebar layout, amber warning icon, "Try again" button, and "Go to dashboard" link
- `src/app/workspace/[repoId]/error.tsx` — Workspace error boundary, full-screen dark layout, red error icon, "Try again" button, and "Back to dashboard" link
- `src/app/not-found.tsx` — Custom 404 page with large "404" heading, "Page not found" text, "Go home" and "Go to dashboard" links

### Files Not Modified (already had handling)
- `src/app/workspace/[repoId]/page.tsx` — Already had null-check for repo (lines 62-71), showing "Repository not found" with back link
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Already had null-check for team (lines 341-357), showing "Team not found" with back link

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with no errors
- Browser test: 404 page renders correctly at non-existent routes with proper heading, text, and navigation links
- Next.js build succeeded with `/_not-found` route in route table

### Reviewer Pass (e26aa279)
- Reviewed all 4 created files (global-error.tsx, (dashboard)/error.tsx, workspace/[repoId]/error.tsx, not-found.tsx)
- All error boundaries have `"use client"` directive as required by Next.js
- `global-error.tsx` correctly includes its own `<html>` and `<body>` tags
- All error pages properly type `error` as `Error & { digest?: string }` and `reset` as `() => void`
- `not-found.tsx` is a server component (no `"use client"`) — correct, Next.js not-found pages can be server components
- All pages use consistent dark theme (zinc-950 bg, white text, zinc-400 secondary)
- All error pages have escape hatches (Try again + navigation links)
- Import of `Link` from `next/link` correct in dashboard error, workspace error, and not-found pages
- `global-error.tsx` correctly uses `<a href="/">` instead of `<Link>` since it renders outside the Next.js router context
- Workspace and team pages already had null-check handling — confirmed present
- `npx -s tsc -p tsconfig.json --noEmit` — passed with zero errors
- No fixes needed — all code is clean

### Reviewer Pass (34824841, iteration 4)
- Re-reviewed all 4 error boundary/not-found files
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed, all routes generated including `/_not-found`
- No fixes needed — all code remains clean
