# Task: Add Session Deep-Linking via URL Query Parameter

## Context

The workspace page (`src/app/workspace/[repoId]/page.tsx`) currently defaults to the most recent session when loaded. There's no way to deep-link to a specific session via the URL. This matters because:

1. The "Recent Work" section on the dashboard (being built) links to `/workspace/{repoId}` — it should link to a specific session so users resume exactly where they left off
2. Users can't bookmark or share a link to a specific session/feature branch
3. Browser back/forward navigation doesn't preserve session state

### What exists now:
- `src/app/workspace/[repoId]/page.tsx` — Uses `useState` for `sessionId`, defaults to most recent session via `useEffect`. No URL param reading.
- `src/app/(dashboard)/home/page.tsx` — The "Recent Work" section (being built by another task) will link to `/workspace/{repoId}`. Once this task is done, it should link to `/workspace/{repoId}?session={sessionId}` instead.
- `convex/sessions.ts` — Has `listByRepo` and `get` queries. No changes needed.

### What's missing:
- No `?session=sessionId` query parameter support in the workspace page
- When switching sessions in the workspace, the URL doesn't update to reflect the active session
- The dashboard "Recent Work" links don't deep-link to specific sessions

## Requirements

### 1. Read `session` query parameter in the workspace page

In `src/app/workspace/[repoId]/page.tsx`, use `useSearchParams` from `next/navigation` to read an optional `session` query parameter:

```typescript
import { useSearchParams } from "next/navigation";

// Inside WorkspacePage:
const searchParams = useSearchParams();
const sessionParam = searchParams.get("session") as Id<"sessions"> | null;
```

Update the initialization `useEffect` to prefer the URL param over the most recent session:

```typescript
useEffect(() => {
  if (initialized || !sessions) return;
  if (sessionParam && sessions.some((s) => s._id === sessionParam)) {
    setSessionId(sessionParam);
  } else if (sessions.length > 0) {
    setSessionId(sessions[0]._id);
  }
  setInitialized(true);
}, [sessions, initialized, sessionParam]);
```

### 2. Update URL when session changes

When the user switches sessions (via the SessionPicker), update the URL to reflect the new session using `router.replace` (not `push`, to avoid polluting browser history):

```typescript
const handleSessionChange = (id: Id<"sessions"> | null) => {
  setSessionId(id);
  setPendingBranchInfo(null);
  // Update URL to reflect active session
  if (id) {
    router.replace(`/workspace/${repoId}?session=${id}`, { scroll: false });
  } else {
    router.replace(`/workspace/${repoId}`, { scroll: false });
  }
};
```

Also update `handleCreateFeatureSession` to set the URL after creating a new session:

```typescript
const handleCreateFeatureSession = async (featureName: string, branchName: string) => {
  setShowNewFeatureDialog(false);
  const newSessionId = await createSession({ repoId, branchName, featureName });
  setSessionId(newSessionId);
  setPendingBranchInfo({ branchName, featureName });
  router.replace(`/workspace/${repoId}?session=${newSessionId}`, { scroll: false });
};
```

### 3. Update dashboard "Recent Work" links to include session ID

In `src/app/(dashboard)/home/page.tsx`, update the `RecentSessions` component (being built by another task) to link to `/workspace/{repoId}?session={sessionId}` instead of just `/workspace/{repoId}`:

```tsx
<Link href={`/workspace/${session.repoId}?session=${session._id}`}>
```

**Note:** This step depends on the "add-recent-sessions-to-dashboard" task completing first. If that task's `RecentSessions` component already exists, update the Link. If not, leave a note in the completion summary so the other task's implementer knows to use the `?session=` param.

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Read `session` query param with `useSearchParams`, use it for initial session selection, update URL on session changes |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Update "Recent Work" links to include `?session={sessionId}` (if the section exists) |

## Acceptance Criteria

1. Navigating to `/workspace/{repoId}?session={sessionId}` opens that specific session
2. If the `session` param refers to a session that doesn't exist or doesn't belong to this repo, falls back to the most recent session (graceful degradation)
3. When switching sessions in the workspace, the URL updates to reflect the active session
4. When creating a new feature session, the URL updates to reflect the new session
5. URL updates use `router.replace` (not `push`) to avoid polluting browser history
6. If no `session` param is provided, the workspace defaults to the most recent session (existing behavior preserved)
7. The dashboard "Recent Work" links include `?session={sessionId}` (if the section exists)
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useSearchParams()` from `next/navigation` — this is the Next.js 15 App Router way to read query params in a client component
- Using `router.replace` instead of `router.push` prevents every session switch from creating a new browser history entry. Users can still use browser back to go back to the dashboard.
- The `{ scroll: false }` option on `router.replace` prevents the page from scrolling to the top on URL change
- The session ID is a Convex document ID (string format like `jd7...`), so it's URL-safe and doesn't need encoding
- This task is independent of the "Recent Work" dashboard task — both can proceed in parallel. The workspace URL param support is useful even without the dashboard links (e.g., for bookmarking)
- `useSearchParams` requires the component to be wrapped in a `<Suspense>` boundary in Next.js 15 — check if the workspace page already has one or if the root layout provides it

## Completion Summary

### What was built
Session deep-linking via URL query parameter (`?session=<sessionId>`). Users can now bookmark, share, and deep-link to specific workspace sessions.

### Changes made

**`src/app/workspace/[repoId]/page.tsx`**
- Added `useSearchParams` import from `next/navigation`
- Read `session` query parameter on page load and use it to select the initial session (with graceful fallback to most recent session if the param is invalid)
- Updated `handleSessionChange` to call `router.replace` with `?session=` param when switching sessions
- Updated `handleCreateFeatureSession` to call `router.replace` with `?session=` param after creating a new session

**`src/app/(dashboard)/home/page.tsx`**
- Updated the `RecentSessions` component `<Link>` href from `/workspace/${session.repoId}` to `/workspace/${session.repoId}?session=${session._id}` so that clicking a recent session deep-links directly to it

### Verification
- TypeScript type check passes with no errors
- Browser tested: deep-link from dashboard to workspace works correctly, session switching updates URL, correct session is loaded from URL param

### Reviewer Notes (agent 8fe95716)

**Issue found and fixed:**
- `src/app/workspace/[repoId]/page.tsx`: `useSearchParams()` was used without a `<Suspense>` boundary. In Next.js 15, this causes the entire page to opt into client-side rendering and can produce build errors. Fixed by wrapping the page content in a `<Suspense>` boundary — renamed the main component to `WorkspacePageInner` and created a new `WorkspacePage` default export that wraps it in `<Suspense>` with a loading spinner fallback.

**No other issues found:**
- TypeScript types are correct
- Imports and paths are valid
- Schema fields (`name`, `featureName`, `firstMessage`, `branchName`, `lastActiveAt`) all exist
- `sessions.listRecent` query exists with correct index usage
- Graceful fallback when session param is invalid
- `router.replace` used correctly with `{ scroll: false }`
