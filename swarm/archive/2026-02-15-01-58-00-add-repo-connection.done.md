# Task: Add Repository Connection (Add Repo to Team)

## Context

Phase 2 (Team & Repo Management) is in progress. Teams can be created and managed (members, invites), but there is **no way to add repositories to a team**. The dashboard shows "No repos connected yet" with no mechanism to add one. The workspace at `/workspace/[repoId]` is unreachable because no repos exist.

This task adds the backend mutation to create a repo and a frontend form on the team management page so owners can connect repos to their teams.

### What exists now:
- `convex/schema.ts` — Has `repos` table with fields: `teamId`, `githubOwner`, `githubRepo`, `githubUrl`, `defaultBranch`, `pushStrategy`, `connectedBy`, `connectedAt`, indexed by `by_teamId`
- `convex/projects.ts` — Has `get` and `listByTeam` queries (read-only, no mutations)
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Team management page with members and invites (but no repo section)
- `src/app/(dashboard)/page.tsx` — Dashboard showing teams with their repos via `TeamRepos` component

## Requirements

### 1. Add `addRepo` mutation to `convex/projects.ts`

Add a mutation that allows team owners to connect a repo:

```typescript
export const addRepo = mutation({
  args: {
    teamId: v.id("teams"),
    githubOwner: v.string(),
    githubRepo: v.string(),
    defaultBranch: v.optional(v.string()),
    pushStrategy: v.union(v.literal("direct"), v.literal("pr")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    // Check for duplicate
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .filter((q) =>
        q.and(
          q.eq(q.field("githubOwner"), args.githubOwner),
          q.eq(q.field("githubRepo"), args.githubRepo),
        ),
      )
      .first();
    if (existing) throw new Error("Repository already connected");

    return await ctx.db.insert("repos", {
      teamId: args.teamId,
      githubOwner: args.githubOwner,
      githubRepo: args.githubRepo,
      githubUrl: `https://github.com/${args.githubOwner}/${args.githubRepo}`,
      defaultBranch: args.defaultBranch ?? "main",
      pushStrategy: args.pushStrategy,
      connectedBy: userId,
      connectedAt: Date.now(),
    });
  },
});
```

### 2. Add `removeRepo` mutation to `convex/projects.ts`

```typescript
export const removeRepo = mutation({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) throw new Error("Repo not found");
    const team = await ctx.db.get("teams", repo.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("repos", args.repoId);
  },
});
```

### 3. Add a "Repositories" section to `src/app/(dashboard)/team/[teamId]/page.tsx`

On the team management page, add a new section (owner-only) below the existing members/invites sections:

**"Repositories" section:**
- List all repos connected to this team (use `api.projects.listByTeam`)
- Each repo shows: `githubOwner/githubRepo`, default branch, push strategy badge ("Direct" or "PR")
- Owner sees a "Remove" button next to each repo
- Below the list, show an "Add Repository" form (owner-only) with:
  - GitHub owner input (e.g. "facebook")
  - Repository name input (e.g. "react")
  - Default branch input (default "main")
  - Push strategy select: "Direct to main" or "Create PR"
  - "Connect" button
- Show "No repositories connected" empty state when list is empty

### 4. Update imports in `convex/projects.ts`

Add the necessary imports for `mutation`, `v`, and `getAuthUserId` (currently only `query` and `v` are imported).

### 5. Run codegen and verify

- Run `npx convex dev --once` after adding the mutations
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/projects.ts` | **Modify** | Add `addRepo` and `removeRepo` mutations with proper auth checks |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add "Repositories" section with repo list, add form, and remove button |

## Acceptance Criteria

1. `convex/projects.ts` has `addRepo` and `removeRepo` mutations
2. `addRepo` validates that the caller is the team owner and prevents duplicate repos
3. `removeRepo` validates team ownership before deleting
4. Team management page shows a "Repositories" section listing connected repos
5. Owner can add a repo via the form with owner, name, branch, and push strategy
6. Owner can remove a repo
7. After adding a repo, it appears on the dashboard under the team card and links to `/workspace/[repoId]`
8. Non-owner members see the repo list but not the add/remove controls
9. `npx convex dev --once` completes successfully
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `repos` table schema requires all fields: `teamId`, `githubOwner`, `githubRepo`, `githubUrl`, `defaultBranch`, `pushStrategy`, `connectedBy`, `connectedAt` — make sure the mutation provides all of them
- `githubUrl` is constructed from owner/repo: `https://github.com/${owner}/${repo}`
- Use `useMutation(api.projects.addRepo)` on the frontend
- The team management page already has the pattern for owner-only sections (check `team.myRole === "owner"`) — follow the same pattern
- Keep the UI consistent with the existing zinc dark theme and card-based layout
