# Task: Wire Workspace Page to Real Repo Data

## Context

The workspace page at `/workspace/[repoId]` currently ignores the `repoId` URL param and creates a demo session with fake data. Now that repos can be added to teams (repo connection task), the workspace needs to load the actual repo from the database, display its info in the header, and create sessions tied to the real repo and authenticated user.

### What exists now:
- `src/app/workspace/[repoId]/page.tsx` — Reads `repoId` from params but never uses it. Creates a demo session via `api.sessions.createDemo`.
- `src/components/layout/Header.tsx` — Shows hardcoded "my-project" text, no repo context.
- `src/components/chat/ChatPanel.tsx` — Creates its own demo session via `createDemo()`. Has no concept of a repo.
- `convex/sessions.ts` — Has `create(repoId, userId)` for real sessions and `createDemo()` for fake ones.
- `convex/projects.ts` — Has `get` query to fetch a repo by ID.
- `convex/users.ts` — Has `currentUser` query.

## Requirements

### 1. Update workspace page to load repo data

Modify `src/app/workspace/[repoId]/page.tsx`:
- Use `useQuery(api.projects.get, { repoId })` to load the repo from the DB
- Show a loading spinner while repo is loading
- Show a "Repository not found" message with a link back to the dashboard if the repo doesn't exist
- Pass the repo info to the Header component
- Pass the `repoId` to ChatPanel (instead of ChatPanel creating its own demo session)

### 2. Update Header to accept and display repo info

Modify `src/components/layout/Header.tsx`:
- Accept optional props: `repoName?: string` (e.g. "owner/repo") and `branchName?: string`
- Display the repo name where it currently says "my-project"
- Display the branch name as a smaller badge or secondary text
- Add a back link/button to navigate to the dashboard (`/`)
- Keep the existing user avatar and sign-out button

### 3. Update ChatPanel to use real sessions

Modify `src/components/chat/ChatPanel.tsx`:
- Accept a `repoId: Id<"repos">` prop instead of creating a demo session
- On mount, call the real `api.sessions.create` mutation with the `repoId` and the current user's ID (or update `sessions.create` to derive userId from auth)
- Remove the dependency on `createDemo`

### 4. Update `convex/sessions.ts` — make `create` use auth

Modify the `create` mutation in `convex/sessions.ts`:
- Remove the `userId: v.string()` arg
- Instead, get the authenticated user via `getAuthUserId(ctx)`
- Throw if not authenticated
- Store the real user ID on the session

```typescript
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = mutation({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const now = Date.now();
    return await ctx.db.insert("sessions", {
      repoId: args.repoId,
      userId,
      createdAt: now,
      lastActiveAt: now,
    });
  },
});
```

### 5. Run codegen and verify

- Run `npx convex dev --once`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/sessions.ts` | **Modify** | Update `create` mutation to use auth instead of userId arg |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Load repo from DB, pass to Header and ChatPanel |
| `src/components/layout/Header.tsx` | **Modify** | Accept repo props, show repo name/branch, add dashboard link |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Accept `repoId` prop, create real session instead of demo |

## Acceptance Criteria

1. Navigating to `/workspace/[repoId]` with a valid repo ID shows the workspace with the repo's name in the header
2. The header shows `owner/repo` and the branch name
3. The header has a way to navigate back to the dashboard
4. ChatPanel creates a real session tied to the repo and authenticated user
5. If the repo ID is invalid, the user sees a "not found" message with a link to the dashboard
6. `convex/sessions.ts` `create` mutation derives userId from auth context
7. `npx convex dev --once` completes successfully
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `repoId` param from Next.js `useParams` is a string — it needs to be cast to `Id<"repos">` for Convex queries
- The `sessions` schema uses `userId: v.string()` — this is compatible with `Id<"users">` since Convex IDs are strings
- Keep the `createDemo` mutation for now (don't delete it) — it may still be useful for testing
- Follow the existing zinc dark theme styling

---

## Completion Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/sessions.ts` | Updated `create` mutation to derive `userId` from auth via `getAuthUserId()` instead of accepting it as an arg. Added `@convex-dev/auth/server` import. Kept `createDemo` mutation intact. |
| `src/app/workspace/[repoId]/page.tsx` | Loads repo from DB via `useQuery(api.projects.get, { repoId })`. Shows loading spinner while fetching, "Repository not found" with dashboard link if null, passes `repoName` and `branchName` to Header, passes `repoId` to ChatPanel. |
| `src/components/layout/Header.tsx` | Accepts optional `repoName` and `branchName` props. Shows `owner/repo` with branch badge when provided. "Artie" is now a `Link` back to the dashboard. |
| `src/components/chat/ChatPanel.tsx` | Now accepts `repoId: Id<"repos">` prop. Creates real session via `api.sessions.create({ repoId })` instead of `createDemo()`. |

### What Was Built
- Workspace page loads the actual repo from the database using the `repoId` URL param
- Header displays the repo name (`owner/repo`) and branch name badge
- Header "Artie" logo links back to the dashboard
- ChatPanel creates real sessions tied to the repo and authenticated user
- Invalid repo IDs show a "Repository not found" page with a dashboard link
- Convex codegen passes successfully
- TypeScript compilation passes (no errors in modified files)

---

## Reviewer Notes (agent 106235de)

**Full codebase review** — reviewed all files from all recent tasks (wire-workspace-to-repo, add-repo-connection, build-team-management, build-landing-page, integrate-real-ai-chat, cleanup-auth-build-dashboard, and settings page).

### Verification
- `npx tsc -p tsconfig.json --noEmit` — passes clean (zero errors)

### Files reviewed (30+ files across frontend and backend)

**Convex backend:**
| File | Status |
|------|--------|
| `convex/ai.ts` | Clean — `"use node"`, proper error handling, lenient response parsing |
| `convex/sessions.ts` | Clean — `create` uses auth, `updatePreviewCode` and `createDemo` intact |
| `convex/projects.ts` | Clean — `addRepo`, `removeRepo`, `getRepoWithTeam`, `updateRepo` all have proper auth/ownership checks |
| `convex/messages.ts` | Clean — `markChangesCommitted` null check correct |
| `convex/teams.ts` | Clean — all 7 functions have proper auth/membership checks |
| `convex/users.ts` | Clean — `currentUser`, `getProfile`, `updateProfile` |
| `convex/schema.ts` | Clean — all tables and indexes consistent with usage |
| `convex/auth.ts` | Clean |
| `convex/http.ts` | Clean |
| `convex/auth.config.ts` | Clean |

**Frontend pages:**
| File | Status |
|------|--------|
| `src/app/page.tsx` | Clean — landing page with `"use client"`, auth check, redirect to `/home` |
| `src/app/(dashboard)/home/page.tsx` | Clean — dashboard with teams/repos, create team form |
| `src/app/(dashboard)/layout.tsx` | Clean — auth guard, loading spinner, redirect |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | Clean — members, invites, repos, add repo form |
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | Clean — owner-only edit, disconnect dialog |
| `src/app/(dashboard)/settings/page.tsx` | Clean — profile edit, sign out |
| `src/app/workspace/[repoId]/page.tsx` | Clean — loads repo from DB, auth guard, not-found state |
| `src/app/(auth)/login/page.tsx` | Clean — redirects to `/home` post-auth |
| `src/app/(auth)/signup/page.tsx` | Clean — redirects to `/home` post-auth |
| `src/app/(auth)/layout.tsx` | Clean — server component |

**Shared components:**
| File | Status |
|------|--------|
| `src/components/layout/Header.tsx` | Clean — links to `/home`, optional repo/branch props |
| `src/components/layout/SplitPane.tsx` | Clean — drag resize works |
| `src/components/chat/ChatPanel.tsx` | Clean — `useAction` for generateResponse, `repoId` prop |
| `src/components/chat/MessageList.tsx` | Clean |
| `src/components/chat/MessageBubble.tsx` | Clean |
| `src/components/preview/PreviewPanel.tsx` | Clean — iframe sandbox, code view toggle |
| `src/components/ConvexClientProvider.tsx` | Clean |

### Checks
- All `"use client"` directives present where needed
- All import paths correct (relative for convex, `@/` for src-internal)
- No stale references to `/` as a dashboard route
- `/settings` link in Header resolves to existing settings page
- Schema fields and indexes consistent with all queries/mutations
- Auth guards on all protected routes (dashboard layout, workspace, settings)
- Loading and error/not-found states handled throughout

**No fixes needed.** Codebase is clean and correct.
