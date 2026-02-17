# Task: Build Invite Acceptance Flow

## Context

Team owners can send invites via email address on the team management page (`/team/[teamId]`), and pending invites are displayed and can be cancelled. However, there is **no way for invited users to accept invites**. This is a critical gap — the invite system is unusable without acceptance.

### What exists now:
- `convex/schema.ts` — `invites` table with `teamId`, `email`, `invitedBy`, `createdAt`, `expiresAt`, indexed by `by_teamId` and `by_email`
- `convex/teams.ts` — `inviteMember` mutation (creates invite), `cancelInvite` mutation (deletes invite), `listInvites` query (owner-only)
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Owner can send invites and see pending invites
- `src/app/(auth)/signup/page.tsx` — Signup page with email/password
- `src/app/(auth)/login/page.tsx` — Login page with email/password
- No invite acceptance page or mutation exists

### How invites work currently:
1. Owner enters an email on the team page → `inviteMember` creates an `invites` record with that email
2. The invite sits in the database with no way to be accepted
3. There's no page for users to view or accept their invites

## Requirements

### 1. Add `acceptInvite` mutation to `convex/teams.ts`

Add a mutation that lets an authenticated user accept a pending invite:

```typescript
export const acceptInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");

    // Check invite hasn't expired
    if (invite.expiresAt < Date.now()) {
      await ctx.db.delete("invites", args.inviteId);
      throw new Error("Invite has expired");
    }

    // Verify the user's email matches the invite
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("_id"), userId))
      .unique();
    if (!user || user.email !== invite.email) {
      throw new Error("This invite is for a different email address");
    }

    // Check if already a member
    const existingMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", invite.teamId).eq("userId", userId),
      )
      .unique();
    if (existingMembership) {
      await ctx.db.delete("invites", args.inviteId);
      throw new Error("You are already a member of this team");
    }

    // Create membership
    await ctx.db.insert("teamMembers", {
      teamId: invite.teamId,
      userId,
      role: "member",
      invitedAt: invite.createdAt,
      joinedAt: Date.now(),
    });

    // Delete the invite
    await ctx.db.delete("invites", args.inviteId);

    return invite.teamId;
  },
});
```

### 2. Add `listMyInvites` query to `convex/teams.ts`

Add a query that returns all pending invites for the currently authenticated user (matched by email):

```typescript
export const listMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("_id"), userId))
      .unique();
    if (!user?.email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .collect();

    // Resolve team names and filter expired
    const now = Date.now();
    const resolved = await Promise.all(
      invites
        .filter((inv) => inv.expiresAt > now)
        .map(async (inv) => {
          const team = await ctx.db.get("teams", inv.teamId);
          return {
            ...inv,
            teamName: team?.name ?? "Unknown Team",
          };
        }),
    );
    return resolved;
  },
});
```

### 3. Add pending invites banner to dashboard (`src/app/(dashboard)/home/page.tsx`)

On the dashboard home page, show a section at the top when the user has pending invites:

- Query `api.teams.listMyInvites`
- If there are pending invites, show a highlighted card/banner for each:
  - "You've been invited to join **{teamName}**"
  - "Accept" button that calls `api.teams.acceptInvite`
  - "Decline" button that calls `api.teams.cancelInvite` (reuse existing mutation — it checks ownership, so we may need a `declineInvite` mutation instead)
- After accepting, the team should appear in the user's team list automatically (reactive query)
- After declining, the invite disappears

### 4. Add `declineInvite` mutation to `convex/teams.ts`

The existing `cancelInvite` checks team ownership. We need a separate mutation for the invitee to decline:

```typescript
export const declineInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");

    // Verify the user's email matches the invite
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("_id"), userId))
      .unique();
    if (!user || user.email !== invite.email) {
      throw new Error("This invite is for a different email address");
    }

    await ctx.db.delete("invites", args.inviteId);
  },
});
```

### 5. Run codegen and verify

- Run `npx convex dev --once`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/teams.ts` | **Modify** | Add `acceptInvite` mutation, `declineInvite` mutation, and `listMyInvites` query |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add pending invites banner at top of dashboard with accept/decline buttons |

## Acceptance Criteria

1. `convex/teams.ts` has `acceptInvite`, `declineInvite`, and `listMyInvites` functions
2. `acceptInvite` validates auth, checks email match, checks expiry, creates team membership, and deletes the invite
3. `declineInvite` validates auth, checks email match, and deletes the invite
4. `listMyInvites` returns pending (non-expired) invites for the current user with team names
5. Dashboard home page shows a banner/card for each pending invite
6. Clicking "Accept" adds the user to the team and the team appears in their team list
7. Clicking "Decline" removes the invite
8. `npx convex dev --once` completes successfully
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `invites` table has a `by_email` index which is perfect for `listMyInvites`
- The `users` table (from `authTables`) stores `email` — use this to match invites
- `teamMembers` `by_teamId_userId` index is used to check for existing membership
- Keep the invite banner styling consistent with the zinc dark theme (bg-zinc-950, borders zinc-800, etc.)
- The invite banner should use a slightly different background (e.g. bg-blue-950/30 or bg-zinc-900 with a blue-400 border) to make it stand out as a call-to-action
- Use `useMutation(api.teams.acceptInvite)` and `useMutation(api.teams.declineInvite)` on the frontend

---

## Completion Summary

### Agent: 01d8b4d4

### Files Modified

| File | Changes |
|------|---------|
| `convex/teams.ts` | Added `listMyInvites` query, `acceptInvite` mutation, and `declineInvite` mutation |
| `src/app/(dashboard)/home/page.tsx` | Added `PendingInvites` component with accept/decline buttons, rendered at top of dashboard |

### What Was Built

1. **`listMyInvites` query** — Looks up the current user's email, queries the `invites` table using the `by_email` index, filters out expired invites, and resolves team names via `Promise.all`.

2. **`acceptInvite` mutation** — Validates authentication, checks invite exists and hasn't expired, verifies the user's email matches the invite, checks for existing team membership, creates a new `teamMembers` record with role "member", and deletes the invite.

3. **`declineInvite` mutation** — Validates authentication, verifies email match, and deletes the invite. Separate from `cancelInvite` which requires team ownership.

4. **`PendingInvites` component** — Client component on the dashboard home page that queries `listMyInvites` and renders a blue-highlighted banner for each pending invite with "Accept" and "Decline" buttons. Uses loading state to disable buttons during mutation execution. Returns `null` when there are no invites (no visual impact on page).

### Verification

- `npx convex codegen` passes successfully
- `npx tsc -p tsconfig.json --noEmit` shows no errors in modified files (pre-existing errors in unrelated files: `convex/ai.ts`, `llm-settings/page.tsx`)
- Next.js production build succeeds
- Browser testing confirmed login/signup pages render correctly with static files loading properly

## Reviewer Notes (agent c476ec74, iteration 2)

**Comprehensive codebase review** — reviewed all 35+ source files across frontend and backend.

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passes clean (zero errors)
- All dependencies installed (`@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `ai`, `@octokit/rest`)

### Files reviewed (no issues found)

**Convex backend (11 files):**
- `convex/ai.ts` — `"use node"` directive correct, team-level LLM config resolution with platform fallback, proper error handling, lenient response parsing
- `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` — Clean
- `convex/github.ts` — `"use node"` correct, Octokit usage, file batching, WebContainer tree builder
- `convex/messages.ts` — `send`, `list`, `markChangesCommitted` all correct
- `convex/projects.ts` — `addRepo`, `removeRepo`, `getRepoWithTeam`, `updateRepo` all have proper auth/ownership checks
- `convex/schema.ts` — All tables and indexes consistent with usage across all backend files
- `convex/sessions.ts` — `create` uses auth, `updatePreviewCode`, `createDemo` intact
- `convex/teams.ts` — All 12 functions including `listMyInvites`, `acceptInvite`, `declineInvite`, `getLlmSettings`, `updateLlmSettings`, `getTeamInternal` have proper auth/membership checks
- `convex/users.ts` — `currentUser`, `getProfile`, `updateProfile` with upsert pattern correct

**Frontend pages (11 files):**
- `src/app/page.tsx` — Landing page with `"use client"`, `useConvexAuth()` + redirect
- `src/app/(auth)/login/page.tsx`, `signup/page.tsx` — Redirect to `/home` post-auth
- `src/app/(auth)/layout.tsx` — Server component
- `src/app/(dashboard)/layout.tsx` — Auth guard with loading/redirect
- `src/app/(dashboard)/home/page.tsx` — Dashboard with teams/repos, PendingInvites, settings gear
- `src/app/(dashboard)/settings/page.tsx` — Profile edit, sign out
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Members, invites, repos, LLM settings link
- `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` — Provider/model/key config, owner-only
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Owner-only edit, disconnect dialog
- `src/app/workspace/[repoId]/page.tsx` — Auth guard, repo loading, session creation

**Shared components (7 files):**
- `src/components/layout/Header.tsx` — Links to `/home`, optional repo/branch props, Settings link
- `src/components/layout/SplitPane.tsx` — Draggable divider with clamping
- `src/components/chat/ChatPanel.tsx` — `useAction` for `generateResponse`, `repoId` prop, session creation with ref guard
- `src/components/chat/MessageList.tsx`, `MessageBubble.tsx` — Clean
- `src/components/preview/PreviewPanel.tsx` — iframe sandbox, code view toggle
- `src/components/ConvexClientProvider.tsx` — Clean

### Checks
- All `"use client"` directives present where needed
- All import paths correct (relative for convex imports, `@/` for src-internal)
- No stale references to `/` as a dashboard route
- Schema fields and indexes consistent with all queries/mutations
- Auth guards on all protected routes
- Loading, error, and not-found states handled throughout
- `tsconfig.json` build directory includes reference existing directories with current route validators

**No fixes needed.** Codebase is clean and correct.
