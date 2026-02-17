# Task: Build Team Management Page

## Context

Phase 1 (Foundation) is complete: schema, auth, dashboard, workspace, chat, preview. Phase 2 (Team & Repo Management) is next. The dashboard already lists teams and repos, and users can create teams. But there's no way to **manage** a team — view members, invite new members, or remove members.

This task builds the team management backend functions and frontend page.

### What exists now:
- `convex/teams.ts` — Has `listMyTeams` query and `createTeam` mutation
- `convex/schema.ts` — Has `teams`, `teamMembers` (with indexes `by_teamId`, `by_userId`, `by_teamId_userId`), and `invites` (with indexes `by_teamId`, `by_email`) tables
- `src/app/(dashboard)/page.tsx` — Dashboard home showing teams and repos
- `src/app/(dashboard)/layout.tsx` — Dashboard layout with auth guard and Header
- No team detail page exists yet

## Requirements

### 1. Add backend functions to `convex/teams.ts`

Add these queries and mutations:

**`getTeam` query** — Fetch a single team by ID (with auth check that the user is a member):
```typescript
export const getTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) => q.eq("teamId", args.teamId).eq("userId", userId))
      .unique();
    if (!membership) return null;
    const team = await ctx.db.get("teams", args.teamId);
    return team ? { ...team, myRole: membership.role } : null;
  },
});
```

**`listMembers` query** — List all members of a team:
```typescript
export const listMembers = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    // Verify caller is a member
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) => q.eq("teamId", args.teamId).eq("userId", userId))
      .unique();
    if (!membership) return [];
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
    // Resolve user info for each member
    const resolved = await Promise.all(
      members.map(async (m) => {
        const user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("_id"), m.userId))
          .unique();
        return { ...m, name: user?.name, email: user?.email };
      })
    );
    return resolved;
  },
});
```

**`listInvites` query** — List pending invites for a team (owner only):
```typescript
export const listInvites = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) return [];
    return await ctx.db
      .query("invites")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});
```

**`inviteMember` mutation** — Create an invite (owner only):
```typescript
export const inviteMember = mutation({
  args: { teamId: v.id("teams"), email: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    // Check for existing invite
    const existing = await ctx.db
      .query("invites")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .filter((q) => q.eq(q.field("email"), args.email))
      .unique();
    if (existing) throw new Error("Already invited");
    return await ctx.db.insert("invites", {
      teamId: args.teamId,
      email: args.email,
      invitedBy: userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  },
});
```

**`removeMember` mutation** — Remove a member from a team (owner only, can't remove self):
```typescript
export const removeMember = mutation({
  args: { teamId: v.id("teams"), memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member || member.teamId !== args.teamId) throw new Error("Member not found");
    if (member.role === "owner") throw new Error("Cannot remove the owner");
    await ctx.db.delete("teamMembers", args.memberId);
  },
});
```

**`cancelInvite` mutation** — Cancel a pending invite (owner only):
```typescript
export const cancelInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");
    const team = await ctx.db.get("teams", invite.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("invites", args.inviteId);
  },
});
```

### 2. Create team management page at `src/app/(dashboard)/team/[teamId]/page.tsx`

Build a page that shows:

- **Team name** as heading with a back link to `/`
- **Members section**: List each member showing name/email and role badge (owner/member). For the owner, show a "Remove" button next to non-owner members.
- **Invite section** (owner only): A form with an email input and "Send Invite" button. Below it, show a list of pending invites with email and a "Cancel" button.
- **Empty states**: If no members besides owner, say "No other members yet". If no pending invites, say "No pending invites".

Design: Match the existing zinc dark theme. Use cards similar to the dashboard.

### 3. Add a "Manage" link on the dashboard

On `src/app/(dashboard)/page.tsx`, add a small "Manage" link/button next to each team name that navigates to `/team/[teamId]`.

### 4. Run codegen and verify

- Run `npx convex dev --once` after adding the new backend functions
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/teams.ts` | **Modify** | Add `getTeam`, `listMembers`, `listInvites`, `inviteMember`, `removeMember`, `cancelInvite` |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Create** | Team management page with members, invites |
| `src/app/(dashboard)/page.tsx` | **Modify** | Add "Manage" link to each team card |

## Acceptance Criteria

1. `convex/teams.ts` has all 6 new functions (`getTeam`, `listMembers`, `listInvites`, `inviteMember`, `removeMember`, `cancelInvite`)
2. Team management page at `/team/[teamId]` shows team name, member list, and invite form
3. Owner can invite by email, see pending invites, cancel invites, and remove non-owner members
4. Non-owner members can see the member list but not the invite/remove controls
5. Dashboard has a "Manage" link on each team card pointing to `/team/[teamId]`
6. Auth guard: unauthenticated users can't access the page; non-members get an empty/error state
7. `npx convex dev --once` completes successfully
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useParams()` to get `teamId` from the route
- The `getTeam` query returns `myRole` so the frontend can conditionally show owner-only controls
- Use `useMutation` for invite/remove/cancel operations
- The `invites` table has `by_teamId` and `by_email` indexes — use them
- The `teamMembers` table has `by_teamId_userId` for checking membership — use `.unique()` since each user can only be a member of a team once
- For member user info lookup, note that the auth `users` table may have `name` and `email` fields. Check what fields are available and display appropriately.
- Keep things simple — no modals, just inline forms and lists

---

## Completion Summary

### What was built
Built the team management backend and frontend page, enabling team owners to view members, invite new members by email, remove members, and cancel pending invites. Non-owner members can view the member list but not the admin controls.

### Files modified
| File | Action | Details |
|------|--------|---------|
| `convex/teams.ts` | Modified | Added 6 functions: `getTeam`, `listMembers`, `listInvites`, `inviteMember`, `removeMember`, `cancelInvite` |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | Created | Team management page with members list, role badges, invite form (owner-only), pending invites list, and back link to dashboard |
| `src/app/(dashboard)/page.tsx` | Modified | Added "Manage" link next to each team name in the team card header |

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed with no errors
- Browser testing: Team page route (`/team/[teamId]`) compiles and renders (200 status). Auth guard correctly redirects unauthenticated users to login. Full interactive testing blocked by missing `JWT_PRIVATE_KEY` environment variable in Convex deployment (pre-existing infrastructure issue, not related to this change).
