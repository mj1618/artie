# Task: Build Dashboard Sidebar Navigation

## Context

The PLAN.md specifies a `Sidebar.tsx` component and a "Dashboard layout with sidebar," but currently the dashboard layout (`src/app/(dashboard)/layout.tsx`) only has a Header and main content area — no sidebar. Users navigate by clicking back buttons and "Manage" links, which is clunky. There's no persistent way to navigate between dashboard sections.

This task adds a sidebar to the dashboard layout with navigation links to all dashboard sections, plus the user's teams listed for quick access.

### What exists now:
- `src/app/(dashboard)/layout.tsx` — Renders `<Header />` + `<main>{children}</main>`, no sidebar
- `src/components/layout/Header.tsx` — Top bar with Artie logo (links to `/home`), Settings link, user avatar, sign out
- `src/components/layout/Sidebar.tsx` — **File does not exist yet** (listed in PLAN.md component tree)
- Dashboard pages: `/home`, `/team/[teamId]`, `/team/[teamId]/llm-settings`, `/repos/[repoId]/settings`, `/settings`

### What's missing:
- No `Sidebar.tsx` component
- No persistent sidebar navigation in the dashboard layout
- Users must rely on back buttons and inline links to navigate between sections

## Requirements

### 1. Create `src/components/layout/Sidebar.tsx`

A vertical sidebar component for dashboard navigation.

**Structure:**
- Fixed width (e.g., `w-56`), full height below header, dark background (`bg-zinc-900` or `bg-zinc-950`), border on right
- **Navigation sections:**
  1. **Main nav** (top):
     - Home (icon + label) → `/home`
     - Settings (icon + label) → `/settings`
  2. **Teams section** (below main nav):
     - Section header: "Teams" with a "+" button to create team (links to `/home` where the create form is, or triggers inline creation)
     - List of user's teams, each linking to `/team/[teamId]`
     - Each team item shows the team name
     - Under each team (or on click), show links to:
       - Team Members → `/team/[teamId]`
       - LLM Settings → `/team/[teamId]/llm-settings`
     - Show connected repos under each team, each linking to `/workspace/[repoId]`

**Active state:** Highlight the current page's nav item using `usePathname()` from `next/navigation`.

**Data:** Use `useQuery(api.teams.listMyTeams)` to get the user's teams. Use `useQuery(api.projects.listByTeam, { teamId })` for repos under each team (or fetch all repos at once if a query exists).

**Styling:**
- Match the existing dark theme (zinc-900 backgrounds, zinc-400 text, white on hover/active)
- Compact nav items: `text-sm`, `px-3 py-2`, rounded, hover state
- Team names slightly indented or in a collapsible section
- Repo links further indented under their team

### 2. Update `src/app/(dashboard)/layout.tsx`

Add the Sidebar to the dashboard layout:

```tsx
return (
  <div className="flex h-screen flex-col bg-zinc-950">
    <Header />
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  </div>
);
```

### 3. Clean up Header navigation

Since the sidebar now provides navigation:
- **Keep** the "Artie" logo link to `/home` in the Header (it's also used in workspace pages without the sidebar)
- **Keep** the user avatar and sign out
- **Remove** the standalone "Settings" text link from the Header (sidebar handles it now) — but only when inside the dashboard layout. The Header is also used in the workspace layout, so the Settings link should remain there. Best approach: leave the Header as-is (it's harmless to have Settings in both places, and keeps the workspace working).

Actually, simplest approach: **leave Header unchanged**. Having Settings in both sidebar and header is fine — they go to the same page. No code change needed for Header.

### 4. Run codegen and verify

- Run `npx convex dev --once` (no schema changes, but good practice)
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/Sidebar.tsx` | **Create** | Sidebar with nav links (Home, Settings) and teams/repos listing |
| `src/app/(dashboard)/layout.tsx` | **Modify** | Add Sidebar alongside main content area |

## Acceptance Criteria

1. `Sidebar.tsx` renders a vertical navigation panel on the left side of all dashboard pages
2. "Home" link navigates to `/home` and is highlighted when active
3. "Settings" link navigates to `/settings` and is highlighted when active
4. User's teams are listed in the sidebar, each linking to `/team/[teamId]`
5. Connected repos appear under their team, each linking to `/workspace/[repoId]`
6. Current page's nav item is visually highlighted (active state via `usePathname()`)
7. Sidebar does NOT appear on workspace pages (`/workspace/[repoId]`) — only dashboard pages
8. Sidebar does NOT appear on auth pages (`/login`, `/signup`) — only dashboard pages
9. Dashboard layout shows sidebar + main content side by side below the header
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The sidebar only appears in the `(dashboard)` route group layout, so workspace and auth pages are unaffected.
- Use `usePathname()` from `next/navigation` to determine the active nav item. Match `/home` exactly, and `/team/[teamId]` with `startsWith`.
- For team repos in the sidebar, you'll need to query repos per team. If that causes too many queries, consider a single `listMyRepos` query that returns all repos for the current user across all teams — but the per-team approach is fine for v1 with a small number of teams.
- Keep the sidebar width fixed (not collapsible) for v1. A collapse toggle can be added as future polish.
- The sidebar should scroll independently if the team/repo list is long (`overflow-y-auto`).

## Completion Summary

### What was built
Created a dashboard sidebar navigation component and integrated it into the dashboard layout.

### Files changed
| File | Action | Description |
|------|--------|-------------|
| `src/components/layout/Sidebar.tsx` | **Created** | Sidebar component with Home/Settings nav links, Teams section with "+" button, team listings with LLM Settings sub-links, and repo listings under each team |
| `src/app/(dashboard)/layout.tsx` | **Modified** | Added Sidebar import and wrapped main content in a flex layout with Sidebar alongside it |

### Implementation details
- **Sidebar.tsx**: `"use client"` component using `usePathname()` for active state highlighting, `useQuery(api.teams.listMyTeams)` for team data, and `useQuery(api.projects.listByTeam)` per team for repo data
- **Layout**: Header stays on top, below it a `flex` row with Sidebar (`w-56`, `shrink-0`) and main content (`flex-1`, `overflow-auto`)
- Active nav items get `bg-zinc-800 text-white`, inactive items get `text-zinc-400` with hover states
- Teams section includes "TEAMS" header with "+" icon linking to `/home` for team creation
- Each team shows its name (links to `/team/[teamId]`), LLM Settings sub-link, and connected repos (linking to `/workspace/[repoId]`)
- Sidebar only appears in `(dashboard)` route group — workspace and auth pages unaffected
- Header left unchanged (Settings link remains in both header and sidebar)

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with no errors
- `npm run build` — succeeded, all routes generated
- Browser testing: app loads correctly, auth pages render (signup/login work but Convex backend missing `JWT_PRIVATE_KEY` env var prevents actual login, which is an environment config issue unrelated to sidebar code)

## Review (Reviewer 74750e9a, iteration 4)

### Files reviewed

| File | Status |
|------|--------|
| `src/components/layout/Sidebar.tsx` | Clean — `"use client"` present, correct relative imports for convex types, `usePathname()` for active state, `useQuery(api.teams.listMyTeams)` and `useQuery(api.projects.listByTeam)` properly used, loading/empty states handled |
| `src/app/(dashboard)/layout.tsx` | Clean — Sidebar correctly integrated in flex layout, auth guard with `useConvexAuth` works, loading spinner shown during auth check |

Also reviewed cross-cutting files from the 4 most recent tasks:
- `convex/schema.ts` — All tables and indexes consistent
- `convex/fileChanges.ts` — Queries/mutations match schema, `saveFileChanges` correctly uses `internalMutation`
- `convex/ai.ts` — File parsing, system prompt, and `repoFileContents` scoping all correct
- `convex/github.ts` — Git Data API flow (blobs → tree → commit → update ref) correct, `pushChanges` has explicit return type
- `convex/messages.ts` — `send` mutation, `get` query, `markChangesCommitted` all correct
- `convex/teams.ts` — `getTeamInternal` internalQuery present for AI action
- `convex/sessions.ts` — `createDemo` mutation present for demo flow
- `convex/projects.ts` — `listByTeam` checks membership before returning repos
- `src/components/chat/ChatPanel.tsx` — `fileChangesByMessageId` map built correctly, apply-changes effect includes reverted check
- `src/components/chat/MessageBubble.tsx` — Push button hidden for reverted changes, `ChangePreview` rendered with correct props
- `src/components/chat/MessageList.tsx` — Props correctly passed through
- `src/components/chat/ChangePreview.tsx` — Revert flow writes originals back to WebContainer, `canRevert` logic correct
- `src/components/preview/PreviewPanel.tsx` — Phase handling and error states correct
- `src/lib/webcontainer/files.ts` — `writeFile` creates parent directories before writing
- `src/lib/webcontainer/index.ts` — Singleton pattern correct

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed, all routes generated

**No fixes needed.** All code from recent tasks is clean and correct.
