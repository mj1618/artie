# Task: Build Account Settings Page

## Context

The PLAN.md lists an account settings page at `/settings` as one of the key screens. The `userProfiles` table exists in the schema but nothing creates or updates profile records. Users currently have no way to view or edit their account details (display name) or sign out from the dashboard.

### What exists now:
- `convex/schema.ts` — `userProfiles` table with `userId`, `displayName`, `githubAccessToken`, `githubUsername`
- `convex/users.ts` — `currentUser` query that returns the auth user record (from `users` table, NOT `userProfiles`)
- `src/app/(dashboard)/layout.tsx` — Dashboard layout with `<Header />` and auth guard
- `src/components/layout/Header.tsx` — Dashboard header (may already have a sign-out button)
- `src/app/(dashboard)/home/page.tsx` — Dashboard home showing teams/repos
- No `src/app/(dashboard)/settings/page.tsx` — settings page does not exist

## Requirements

### 1. Add profile backend functions (`convex/users.ts`)

Add to `convex/users.ts`:

**`getProfile` query:**
- Get the authenticated user's ID via `getAuthUserId(ctx)`
- Look up their `userProfiles` record using the `by_userId` index
- Return the profile (or null if none exists yet)

**`updateProfile` mutation:**
- Get the authenticated user's ID
- Accept `displayName: v.string()` as an arg
- If a `userProfiles` record exists for this user, patch it
- If not, insert a new one
- This is an "upsert" pattern

```typescript
export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return profile;
  },
});

export const updateProfile = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch("userProfiles", existing._id, {
        displayName: args.displayName,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: args.displayName,
      });
    }
  },
});
```

### 2. Create settings page (`src/app/(dashboard)/settings/page.tsx`)

Create a settings page with:

**Profile section:**
- Show the user's email (from `currentUser` query — the auth user record)
- Editable display name field (from `getProfile` query)
- "Save" button that calls `updateProfile`
- Show success feedback after saving

**Account section:**
- Show account creation info if available
- "Sign out" button (using `useAuthActions` from `@convex-dev/auth/react`)

**Design:**
- Follow the existing zinc dark theme (bg-zinc-950, borders zinc-800, text zinc-100/200/400/500)
- Use the same form styling as team management page
- Max width container like the dashboard home page (`max-w-3xl`)
- Sections separated by dividers

### 3. Add navigation to settings

Update the dashboard header or home page to include a link to `/settings`. Check `src/components/layout/Header.tsx` to see if it already has a user menu — if so, add a "Settings" link there. If not, add a simple link.

### 4. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/users.ts` | **Modify** | Add `getProfile` query and `updateProfile` mutation |
| `src/app/(dashboard)/settings/page.tsx` | **Create** | Account settings page with profile editing and sign-out |
| `src/components/layout/Header.tsx` | **Modify** | Add "Settings" link in header/user menu |

## Acceptance Criteria

1. `convex/users.ts` has `getProfile` query and `updateProfile` mutation
2. `/settings` page shows user email and editable display name
3. Saving display name persists via `updateProfile` mutation (profile is upserted)
4. Sign-out button works from the settings page
5. Header or dashboard has a visible link to `/settings`
6. Page follows the existing zinc dark theme
7. `npm -s convex codegen` completes successfully
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useAuthActions` from `@convex-dev/auth/react` for the sign-out action — call `signOut()` then `router.push("/login")`
- The `users` table (from `authTables`) has `name` and `email` fields. The `userProfiles` table is a separate extension table
- Keep the page simple — no GitHub token management in this task (that's a Phase 2 GitHub OAuth task)
- The `currentUser` query already exists and returns the auth user — use it for email display

## Completion Summary

### Files Modified
- **`convex/users.ts`** — Added `getProfile` query and `updateProfile` mutation with upsert pattern for `userProfiles` table
- **`src/components/layout/Header.tsx`** — Added "Settings" link in header next to user avatar

### Files Created
- **`src/app/(dashboard)/settings/page.tsx`** — Account settings page with:
  - Profile section showing user email (read-only) and editable display name
  - Save button calling `updateProfile` mutation with success feedback
  - Account section with sign-out button (uses `useAuthActions` + router redirect to `/login`)
  - Zinc dark theme consistent with existing dashboard pages
  - `max-w-3xl` container matching dashboard home layout

### Verification
- `npx convex codegen` — completed successfully
- `npx tsc -p tsconfig.json --noEmit` — passed with no errors
- Next.js build — succeeded, `/settings` route registered as static page
- Browser test — app loads correctly, auth guard redirects unauthenticated users to `/login` as expected

## Reviewer Notes (agent 391b96b2, iteration 2)

**Full codebase review** — reviewed all 30+ source files across frontend and backend.

### Fix applied
1. **`tsconfig.json`** — Removed stale build directory includes (`builds/repo-settings-build`, `builds/settings-build`, `builds/invite-flow-test`) that accumulated from previous agents' builds. These contained auto-generated Next.js route validators that could cause TS errors if routes change.

### Files reviewed (no issues found)

**Convex backend (10 files):**
- `convex/ai.ts` — `"use node"` directive correct, `generateText` call with proper error handling, lenient response parsing
- `convex/sessions.ts` — `create` uses auth, `updatePreviewCode` and `createDemo` intact, all mutations correct
- `convex/projects.ts` — `addRepo`, `removeRepo`, `getRepoWithTeam`, `updateRepo` all have proper auth/ownership checks
- `convex/messages.ts` — `send`, `list`, `markChangesCommitted` all correct with proper null checks
- `convex/teams.ts` — All 10 functions have proper auth/membership checks, invite flow complete
- `convex/users.ts` — `currentUser`, `getProfile`, `updateProfile` with upsert pattern correct
- `convex/schema.ts` — All tables and indexes consistent with all queries/mutations
- `convex/auth.ts`, `convex/http.ts`, `convex/auth.config.ts` — Clean

**Frontend pages (10 files):**
- `src/app/page.tsx` — Landing page with `"use client"`, auth redirect to `/home`, proper loading state
- `src/app/(dashboard)/home/page.tsx` — Dashboard with teams/repos, create team form, settings gear on repos
- `src/app/(dashboard)/layout.tsx` — Auth guard with loading spinner and redirect
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Members, invites, repos, add repo form, owner-only sections
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Owner-only edit, disconnect dialog, proper loading/not-found states
- `src/app/(dashboard)/settings/page.tsx` — Profile edit with upsert, sign out button, consistent styling
- `src/app/workspace/[repoId]/page.tsx` — Loads repo from DB, auth guard, not-found state, passes props to Header/ChatPanel
- `src/app/(auth)/login/page.tsx` — Redirects to `/home` post-auth
- `src/app/(auth)/signup/page.tsx` — Password validation, redirects to `/home` post-auth
- `src/app/(auth)/layout.tsx` — Server component, no hooks

**Shared components (6 files):**
- `src/components/layout/Header.tsx` — Links to `/home`, optional repo/branch props, Settings link
- `src/components/layout/SplitPane.tsx` — Drag resize
- `src/components/chat/ChatPanel.tsx` — `useAction` for generateResponse, `repoId` prop, session creation with ref guard
- `src/components/chat/MessageList.tsx` — Clean
- `src/components/chat/MessageBubble.tsx` — Clean
- `src/components/preview/PreviewPanel.tsx` — iframe sandbox, code view toggle
- `src/components/ConvexClientProvider.tsx` — Clean

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed clean after tsconfig cleanup
- All `"use client"` directives present where needed
- All import paths correct
- No stale references to `/` as a dashboard route
- Schema fields and indexes consistent with all queries/mutations
- Auth guards on all protected routes
- Loading and error/not-found states handled throughout

**Codebase is clean and correct.**
