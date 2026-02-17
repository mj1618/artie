# Task: Add Loading Skeleton Screens to Dashboard Pages

## Context

All dashboard pages currently show either a bare spinner, "Loading..." text, or nothing at all while Convex queries are resolving. This creates a jarring experience — the page jumps from empty to fully loaded. Skeleton screens (animated placeholder UI that mimics the layout of the real content) provide a much smoother perceived loading experience.

This is a Phase 6 polish item: "Loading states and animations."

### What exists now:
- `src/app/(dashboard)/layout.tsx` — Shows a centered spinner while auth is loading, then renders sidebar + main content
- `src/app/(dashboard)/home/page.tsx` — No loading state for teams list; just renders nothing until data arrives
- `src/app/(dashboard)/team/[teamId]/page.tsx` — MembersList shows "Loading..." text; no skeleton for the overall page
- `src/app/(dashboard)/settings/page.tsx` — Renders form fields immediately, but user data (`user?.email`) shows "—" while loading
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Likely shows partial/blank state while loading
- `src/components/layout/Sidebar.tsx` — Teams list in sidebar has no loading skeleton
- `src/app/workspace/[repoId]/page.tsx` — Shows centered spinner while loading auth/repo, then jumps to full workspace

### What's missing:
- No reusable skeleton component
- No skeleton states on dashboard pages while Convex queries load
- No skeleton in sidebar while teams load

## Requirements

### 1. Create `src/components/ui/Skeleton.tsx`

A reusable skeleton component that renders animated placeholder blocks.

```tsx
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-zinc-800 ${className ?? ""}`}
    />
  );
}
```

This is a single building block. Compose it to build page-level skeletons.

### 2. Create `src/components/ui/DashboardSkeleton.tsx`

Pre-composed skeleton layouts for common dashboard patterns:

**`PageHeaderSkeleton`** — Mimics a page heading + subtitle:
```tsx
export function PageHeaderSkeleton() {
  return (
    <div>
      <Skeleton className="h-7 w-48" />       {/* Title */}
      <Skeleton className="mt-2 h-4 w-72" />  {/* Subtitle */}
    </div>
  );
}
```

**`CardSkeleton`** — Mimics a bordered card section (like the ones on settings/team pages):
```tsx
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <Skeleton className="h-5 w-32" />  {/* Card title */}
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" style={{ width: `${80 - i * 10}%` }} />
        ))}
      </div>
    </div>
  );
}
```

**`ListItemSkeleton`** — Mimics a list item row (for team members, repos, etc.):
```tsx
export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-16 rounded-md" />
    </div>
  );
}
```

### 3. Add loading skeleton to `src/app/(dashboard)/home/page.tsx`

When `teams` query is `undefined` (loading), show:
- PageHeaderSkeleton for the "Welcome" heading
- 2-3 CardSkeletons for the teams list area
- Keep the "Create a Team" form visible (it doesn't depend on data)

### 4. Add loading skeleton to `src/app/(dashboard)/team/[teamId]/page.tsx`

When `team` data is loading, show:
- PageHeaderSkeleton for the team name
- CardSkeleton for the members section
- CardSkeleton for the invites section
- CardSkeleton for the repos section

Replace the inline "Loading..." text in MembersList with a few `ListItemSkeleton` rows.

### 5. Add loading skeleton to `src/app/(dashboard)/settings/page.tsx`

When `user` or `profile` is loading, show:
- PageHeaderSkeleton for "Account Settings"
- Two CardSkeletons for the Profile and Account sections

### 6. Add loading skeleton to `src/components/layout/Sidebar.tsx`

When the teams query is loading (undefined), show:
- 2-3 `Skeleton` bars under the "TEAMS" header mimicking team name + repo links

### 7. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/ui/Skeleton.tsx` | **Create** | Base skeleton component with pulse animation |
| `src/components/ui/DashboardSkeleton.tsx` | **Create** | Pre-composed skeletons: PageHeaderSkeleton, CardSkeleton, ListItemSkeleton |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add skeleton while teams are loading |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add skeleton while team data is loading, replace "Loading..." in MembersList |
| `src/app/(dashboard)/settings/page.tsx` | **Modify** | Add skeleton while user/profile data is loading |
| `src/components/layout/Sidebar.tsx` | **Modify** | Add skeleton for teams list while loading |

## Acceptance Criteria

1. `Skeleton` component renders an animated pulse placeholder with customizable size via className
2. Dashboard home page shows skeleton cards while teams query loads
3. Team page shows skeleton sections while team/members/repos load
4. Settings page shows skeleton cards while user data loads
5. Sidebar shows skeleton items under "TEAMS" while teams query loads
6. Skeletons match the dark theme (zinc-800 background, pulse animation)
7. Skeletons are replaced by real content once data loads (no flash of skeleton after data arrives)
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use Tailwind's built-in `animate-pulse` class — no custom animation needed
- Skeleton dimensions should roughly match the real content they replace (heading heights, card widths, etc.)
- Check for `undefined` (query loading) vs `null` (query returned no result) vs `[]` (empty list) — only show skeletons for `undefined`
- The skeleton components are purely visual — no data dependencies, no hooks
- Keep the `Skeleton` base component tiny (< 10 lines) so it's easy to compose ad-hoc
- Don't add skeletons to the workspace page — it already has a phased loading UI with the WebContainer status bar

---

## Completion Summary

### Files Created
- `src/components/ui/Skeleton.tsx` — Base skeleton component with `animate-pulse` animation, accepts `className` and `style` props
- `src/components/ui/DashboardSkeleton.tsx` — Pre-composed skeleton layouts: `PageHeaderSkeleton`, `CardSkeleton` (configurable line count), `ListItemSkeleton`

### Files Modified
- `src/app/(dashboard)/home/page.tsx` — Replaced spinner with 3 `CardSkeleton` cards when teams query is loading; replaced "Loading..." text in `TeamRepos` with `ListItemSkeleton` rows
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Replaced spinner with `PageHeaderSkeleton` + 3 `CardSkeleton` cards when team is loading; replaced "Loading..." in `MembersList` with `ListItemSkeleton` rows; replaced "Loading..." in `RepoList` with `ListItemSkeleton` rows
- `src/app/(dashboard)/settings/page.tsx` — Added early return with `PageHeaderSkeleton` + 2 `CardSkeleton` cards when user/profile data is loading
- `src/components/layout/Sidebar.tsx` — Replaced "Loading..." text with `Skeleton` bars mimicking team names and repo links

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with no errors
- `npm run build` — passed, all pages built successfully
- Browser test: app loads correctly (login/signup pages verified), but dashboard pages require authentication to visually confirm skeleton states

---

## Review (b3b0e365)

**Reviewed all 6 files (2 created, 4 modified). No issues found.**

Checks performed:
- All `"use client"` directives present where needed (Skeleton/DashboardSkeleton are pure components, no directive needed)
- All imports resolve correctly — convex imports use relative paths (correct since `convex/` is at project root, not under `src/`)
- Skeleton components properly typed with optional `className` and `style` props
- Loading guards correctly check `=== undefined` (loading) vs `null` (not found) vs `[]` (empty)
- `w-30` in Sidebar.tsx is valid in Tailwind v4 (auto-generated spacing scale)
- `npm -s tsc -p tsconfig.json --noEmit` — passed
- `npx convex dev --once` — passed

No fixes needed.
