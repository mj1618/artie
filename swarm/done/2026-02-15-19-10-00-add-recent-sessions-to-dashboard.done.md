# Task: Add Recent Sessions Section to Dashboard Home Page

## Context

The dashboard home page (`src/app/(dashboard)/home/page.tsx`) currently shows teams and their connected repos, an onboarding checklist, and pending invites. But it doesn't show the user's **recent work sessions** — there's no way to quickly jump back to a session you were working on yesterday without navigating to the specific repo's workspace first.

Now that sessions have `featureName` and `branchName` fields (from the feature-branch-sessions task), recent sessions carry meaningful context: the feature being worked on, the branch name, and the last message. Showing these on the dashboard creates a "pick up where you left off" experience.

### What exists now:
- `src/app/(dashboard)/home/page.tsx` — Dashboard with teams, repos, onboarding, pending invites. No sessions section.
- `convex/sessions.ts` — Has `listByRepo` query (sessions for a single repo). No cross-repo "recent sessions" query.
- `convex/schema.ts` — Sessions table with `repoId`, `userId`, `branchName`, `featureName`, `name`, `firstMessage`, `lastActiveAt`, `createdAt`.
- Sessions table has a `by_userId` index.

### What's missing:
- No Convex query to fetch a user's recent sessions across all repos
- No "Recent Work" section on the dashboard
- No quick way to resume a session from the dashboard

## Requirements

### 1. Add `listRecent` query to `convex/sessions.ts`

Create a query that returns the user's most recently active sessions across all repos:

```typescript
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 5;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    // Resolve repo info for each session
    const resolved = await Promise.all(
      sessions.map(async (session) => {
        const repo = await ctx.db.get("repos", session.repoId);
        return {
          ...session,
          repoName: repo ? `${repo.githubOwner}/${repo.githubRepo}` : "Unknown repo",
          repoDefaultBranch: repo?.defaultBranch ?? "main",
        };
      }),
    );

    return resolved;
  },
});
```

**Note:** The `by_userId` index includes `_creationTime` implicitly. Using `.order("desc")` will return sessions by `_creationTime` descending. However, we actually want to sort by `lastActiveAt`. Since we can't sort by a non-indexed field in a range query, fetch all user sessions (with a reasonable take limit) and sort in JS, OR add a composite index. The simpler approach: take a larger batch (e.g., 20) and sort client-side or in the handler by `lastActiveAt`, then slice to `limit`. Sessions per user are unlikely to exceed a few hundred.

Better approach:
```typescript
const sessions = await ctx.db
  .query("sessions")
  .withIndex("by_userId", (q) => q.eq("userId", userId))
  .collect();

// Sort by lastActiveAt descending and take the top N
const sorted = sessions
  .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  .slice(0, limit);
```

### 2. Add "Recent Work" section to the dashboard home page

In `src/app/(dashboard)/home/page.tsx`, add a new section above "Your Teams" showing recent sessions:

```tsx
function RecentSessions() {
  const sessions = useQuery(api.sessions.listRecent, { limit: 5 });

  if (sessions === undefined) {
    return (
      <div className="space-y-2">
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    );
  }

  if (sessions.length === 0) return null; // Don't show section if no sessions

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-200">Recent Work</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <ul className="divide-y divide-zinc-800">
          {sessions.map((session) => (
            <li key={session._id}>
              <Link
                href={`/workspace/${session.repoId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/50"
              >
                {/* Branch/feature icon */}
                <svg ...>...</svg>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">
                    {session.featureName ?? session.name ?? session.firstMessage ?? "Untitled session"}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="truncate">{session.repoName}</span>
                    {session.branchName && (
                      <>
                        <span>·</span>
                        <span className="truncate font-mono text-blue-400">{session.branchName}</span>
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-xs text-zinc-500">
                  {formatRelativeTime(session.lastActiveAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

Place the `<RecentSessions />` component between the pending invites section and the "Your Teams" section.

### 3. Add `formatRelativeTime` helper

The dashboard doesn't currently have a relative time formatter. Either extract it from `SessionPicker.tsx` into a shared util, or duplicate the simple version inline. The `SessionPicker` already has one — ideally move it to `src/lib/utils.ts` or just copy it inline in the dashboard.

### 4. Run codegen and verify

- Run `npm -s convex codegen` to regenerate types with the new query
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/sessions.ts` | **Modify** | Add `listRecent` query that fetches user's recent sessions across repos with repo info |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add `RecentSessions` component showing up to 5 recent sessions with feature name, repo, branch, and relative time |

## Acceptance Criteria

1. A new `listRecent` query exists in `convex/sessions.ts` that returns the user's most recently active sessions across all repos
2. Each returned session includes `repoName` (owner/repo format) for display
3. Sessions are sorted by `lastActiveAt` descending (most recent first)
4. The dashboard home page shows a "Recent Work" section when the user has sessions
5. The "Recent Work" section is hidden when the user has no sessions (no empty state — just omit the section)
6. Each session row shows: feature name or session name, repo name, branch name (if set), and relative time since last activity
7. Clicking a session row navigates to `/workspace/{repoId}` (the workspace will auto-select the most recent session for that repo)
8. The section shows a loading skeleton while data is being fetched
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useQuery` (not `useAction`) since this is a Convex database query — it subscribes to real-time updates
- The `by_userId` index allows efficient filtering by user. Sorting by `lastActiveAt` happens in the handler since there's no composite index for it — this is fine because a single user won't have thousands of sessions
- The Link goes to `/workspace/{repoId}` without specifying a session — the workspace page already defaults to the most recent session for the repo. A future enhancement could deep-link to a specific session.
- The "Recent Work" section should appear ABOVE "Your Teams" because it's the most actionable content — users want to resume work quickly
- Use the same card/list styling as the team repos section for visual consistency

## Completion Summary

### What was built
Added a "Recent Work" section to the dashboard home page that shows the user's most recently active sessions across all repos, enabling a "pick up where you left off" experience.

### Files modified
| File | Changes |
|------|---------|
| `convex/sessions.ts` | Added `listRecent` query — fetches all user sessions via `by_userId` index, sorts by `lastActiveAt` descending in JS, resolves repo names via `Promise.all`, returns top N sessions |
| `src/app/(dashboard)/home/page.tsx` | Added `formatRelativeTime` helper and `RecentSessions` component. Placed `<RecentSessions />` between PendingInvites and "Your Teams" section |

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — no errors
- Browser tested: "Recent Work" section renders correctly with session name, repo, branch, and relative time. Links navigate to correct workspace URLs. Section hidden when empty, loading skeleton shown while data fetches.

## Review (b36143a0)

Reviewed all modified files. No issues found:
- `convex/sessions.ts` `listRecent` — query logic is correct; `by_userId` index used properly, `lastActiveAt` sort in JS is fine given session count per user, repo names resolved with `Promise.all`
- `src/app/(dashboard)/home/page.tsx` `RecentSessions` — loading/empty states handled correctly, links include `?session=` deep-link param, `formatRelativeTime` helper is clean
- `src/app/workspace/[repoId]/page.tsx` — deep-linking via `useSearchParams` implemented correctly; graceful fallback when session param is invalid; URL updated on session change with `router.replace` and `scroll: false`
- TypeScript check (`tsc --noEmit`) passes with no errors
- Import paths are consistent (relative for convex imports, `@/` for src imports)
- No fixes needed

## Review 2 (7d8bb513)

Second-pass review confirmed: no issues found. All query logic, component rendering, loading states, deep-link URLs, and prop types verified correct. `tsc --noEmit` passes cleanly.
