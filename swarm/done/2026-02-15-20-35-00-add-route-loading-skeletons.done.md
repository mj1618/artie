# Task: Add Next.js Route-Level Loading Skeletons

## Context

Phase 7 (Polish & Launch) includes "Loading states and animations." The app has inline loading spinners and `DashboardSkeleton` components (`PageHeaderSkeleton`, `CardSkeleton`, `ListItemSkeleton`), but **no Next.js `loading.tsx` files**. Without `loading.tsx`, when a user navigates between dashboard pages, they see a blank/stale content area until the new page's client components mount and their data loads. This creates a jarring, unpolished feel.

Next.js App Router's `loading.tsx` convention wraps each page in a `<Suspense>` boundary automatically. When a user navigates to a route, the loading UI shows **instantly** before the page component even starts rendering. This is the standard way to provide immediate navigation feedback in Next.js.

### What exists now:
- `src/components/ui/Skeleton.tsx` — Base `<Skeleton>` component (pulse animation)
- `src/components/ui/DashboardSkeleton.tsx` — `PageHeaderSkeleton`, `CardSkeleton`, `ListItemSkeleton` helpers
- Individual pages handle their own loading states inline (e.g., `if (data === undefined) return <spinner>`)
- No `loading.tsx` files anywhere in the app

### What's missing:
- `src/app/(dashboard)/loading.tsx` — Loading skeleton for all dashboard pages
- `src/app/(dashboard)/home/loading.tsx` — Specific skeleton for the home/dashboard page (teams, repos, sessions)
- `src/app/workspace/[repoId]/loading.tsx` — Loading skeleton for the workspace page

## Requirements

### 1. Create `src/app/(dashboard)/loading.tsx`

This is the **fallback** loading skeleton for any dashboard page that doesn't have its own `loading.tsx`. It provides a generic page skeleton.

```tsx
import {
  PageHeaderSkeleton,
  CardSkeleton,
} from "@/components/ui/DashboardSkeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeaderSkeleton />
      <div className="mt-8 space-y-6">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    </div>
  );
}
```

**Key points:**
- Server component (no `"use client"`) — skeleton components don't need client-side features
- Matches the `max-w-4xl px-6 py-10` layout used by most dashboard pages
- Shows a generic header + two card skeletons — reasonable for settings, team, repo settings pages

### 2. Create `src/app/(dashboard)/home/loading.tsx`

A more specific skeleton for the dashboard home page, which shows team cards with repo lists and recent sessions.

```tsx
import {
  PageHeaderSkeleton,
  CardSkeleton,
  ListItemSkeleton,
} from "@/components/ui/DashboardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeaderSkeleton />
      <div className="mt-8 space-y-8">
        {/* Team card skeleton */}
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-800 bg-zinc-900"
          >
            {/* Team header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Repo list items */}
            <div className="divide-y divide-zinc-800">
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3. Create `src/app/workspace/[repoId]/loading.tsx`

A skeleton for the workspace page showing the split-pane layout (chat panel + preview panel).

```tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Chat panel skeleton */}
      <div className="flex w-[400px] flex-col border-r border-zinc-800">
        {/* Session picker area */}
        <div className="border-b border-zinc-800 p-3">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        {/* Message area */}
        <div className="flex-1 space-y-4 p-4">
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
          <Skeleton className="h-20 w-3/4 rounded-lg" />
        </div>
        {/* Input area */}
        <div className="border-t border-zinc-800 p-3">
          <Skeleton className="h-20 w-full rounded-md" />
        </div>
      </div>
      {/* Preview panel skeleton */}
      <div className="flex flex-1 flex-col">
        {/* Preview navbar */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 flex-1 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
        {/* Preview content area */}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Skeleton className="mx-auto h-12 w-12 rounded-full" />
            <Skeleton className="mx-auto mt-4 h-4 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 4. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open the app and navigate between dashboard pages to confirm the loading skeleton appears during navigation

## Files to Create

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/loading.tsx` | **Create** | Generic dashboard loading skeleton (header + cards) |
| `src/app/(dashboard)/home/loading.tsx` | **Create** | Home page loading skeleton (team cards with repo list items) |
| `src/app/workspace/[repoId]/loading.tsx` | **Create** | Workspace loading skeleton (chat panel + preview panel split) |

## Acceptance Criteria

1. `src/app/(dashboard)/loading.tsx` exists and exports a default component with generic page skeleton
2. `src/app/(dashboard)/home/loading.tsx` exists and exports a default component matching the home page layout (team cards with list items)
3. `src/app/workspace/[repoId]/loading.tsx` exists and exports a default component matching the workspace split-pane layout
4. All loading files are **server components** (no `"use client"` directive) — they use only the existing Skeleton components which are pure HTML/CSS
5. Skeletons use the existing `Skeleton`, `PageHeaderSkeleton`, `CardSkeleton`, and `ListItemSkeleton` components
6. Skeletons match the approximate layout of the pages they stand in for (max-w-4xl for dashboard, split-pane for workspace)
7. Styling is consistent with the existing dark theme (zinc-950 bg, zinc-800 borders, zinc-900 card bg)
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- `loading.tsx` files are **server components** by default in Next.js 15. They don't need `"use client"` unless they use hooks or browser APIs. Our skeletons are pure HTML/CSS, so server components are fine.
- Next.js automatically wraps each `page.tsx` in a `<Suspense fallback={<Loading />}>` when a sibling `loading.tsx` exists. This means the loading skeleton appears instantly on navigation, before the page component mounts.
- The `(dashboard)/loading.tsx` acts as a **fallback** for any dashboard page that doesn't have its own `loading.tsx` (e.g., settings, team, PR pages). The `home/loading.tsx` takes precedence for the home route specifically since it's more specific.
- Keep skeletons lightweight — no data fetching, no complex logic. They should render in <1ms.
- The workspace loading skeleton should approximate the two-panel layout (chat + preview) so the user sees a familiar structure while loading.

## Completion Summary

### Files Created
| File | Description |
|------|-------------|
| `src/app/(dashboard)/loading.tsx` | Generic dashboard loading skeleton with `PageHeaderSkeleton` + two `CardSkeleton` components |
| `src/app/(dashboard)/home/loading.tsx` | Home page loading skeleton with team card skeletons containing `ListItemSkeleton` rows |
| `src/app/workspace/[repoId]/loading.tsx` | Workspace loading skeleton with chat panel + preview panel split-pane layout |

### What Was Built
- Added three Next.js `loading.tsx` files that provide instant visual feedback during route transitions
- All files are server components (no `"use client"` directive) — they use only the existing `Skeleton`, `PageHeaderSkeleton`, `CardSkeleton`, and `ListItemSkeleton` components
- Generic dashboard skeleton acts as fallback for settings, team, PR, and other dashboard pages
- Home skeleton specifically matches the team cards + repo list layout
- Workspace skeleton approximates the chat + preview split-pane layout
- TypeScript check passes with no errors
- Verified in browser: pages render correctly, navigation works

## Review (agent 77c485a1)

Reviewed all three loading files. No issues found:
- All imports resolve correctly to existing exports in `DashboardSkeleton.tsx` and `Skeleton.tsx`
- Component props used correctly (`CardSkeleton lines={4}`, `Skeleton className=...`)
- Server components (no `"use client"`) — appropriate since skeletons are pure HTML/CSS
- TypeScript check passes clean (`npx tsc --noEmit`)
- No fixes needed
