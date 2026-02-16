# Task: Add Template Project Backend CRUD and Convex API Actions

## Context

Phase 6 includes the ability to create applications from templates. The `templateProjects` table already exists in `convex/schema.ts` (lines 108-125) with fields for `teamId`, `name`, `slug`, `template`, `createdBy`, `createdAt`, `convexProjectId`, `convexDeploymentUrl`, `convexDeployKey`, `flyioAppName`, `flyioDeployKey`, `status`, and `errorMessage`, with `by_teamId` and `by_slug` indexes.

However, there are **zero** backend functions for template projects — no queries, mutations, or actions. This task adds the CRUD backend and the Convex API integration actions needed for the template creation flow.

### What exists now:
- `convex/schema.ts` — `templateProjects` table with all fields and indexes
- `convex/projects.ts` — Repo CRUD only (no template project functions)
- `convex/deployKeys.ts` — Fly.io deploy key CRUD (being built by another worker)
- Dashboard home page shows GitHub repos but has no template project section

### What's missing:
- Backend queries to list template projects for a team
- Backend mutation to create a template project
- Backend mutation to delete a template project
- Backend mutation to update template project status
- Convex API action to check slug availability and create projects (stub — real API integration later)

## Requirements

### 1. Create `convex/templates.ts` with CRUD functions

Create a new file with these functions:

**`listByTeam` (query):**
```typescript
export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", args.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];
    return await ctx.db
      .query("templateProjects")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});
```

**`get` (query):**
```typescript
export const get = query({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) return null;
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", project.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return null;
    return project;
  },
});
```

**`create` (mutation):**
```typescript
export const create = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    slug: v.string(),
    template: v.literal("nextjs-convex"),
    flyioDeployKeyId: v.id("flyioDeployKeys"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    // Verify the deploy key exists and belongs to this team
    const deployKey = await ctx.db.get("flyioDeployKeys", args.flyioDeployKeyId);
    if (!deployKey || deployKey.teamId !== args.teamId)
      throw new Error("Deploy key not found");

    // Check slug uniqueness within our system
    const existingSlug = await ctx.db
      .query("templateProjects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.toLowerCase()))
      .first();
    if (existingSlug) throw new Error("Slug already in use");

    // Create the project in "provisioning" state
    // Actual Convex API calls and Fly.io provisioning happen in a separate action
    return await ctx.db.insert("templateProjects", {
      teamId: args.teamId,
      name: args.name.trim(),
      slug: args.slug.toLowerCase().trim(),
      template: args.template,
      createdBy: userId,
      createdAt: Date.now(),
      // Placeholder values — will be updated by the provisioning action
      convexProjectId: "",
      convexDeploymentUrl: "",
      convexDeployKey: "",
      flyioAppName: `artie-${args.slug.toLowerCase()}`,
      flyioDeployKey: deployKey.encryptedKey,
      status: "provisioning",
    });
  },
});
```

**`updateStatus` (mutation):**
```typescript
export const updateStatus = mutation({
  args: {
    projectId: v.id("templateProjects"),
    status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    convexProjectId: v.optional(v.string()),
    convexDeploymentUrl: v.optional(v.string()),
    convexDeployKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) throw new Error("Project not found");
    const updates: Record<string, unknown> = { status: args.status };
    if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
    if (args.convexProjectId !== undefined) updates.convexProjectId = args.convexProjectId;
    if (args.convexDeploymentUrl !== undefined) updates.convexDeploymentUrl = args.convexDeploymentUrl;
    if (args.convexDeployKey !== undefined) updates.convexDeployKey = args.convexDeployKey;
    await ctx.db.patch("templateProjects", args.projectId, updates);
  },
});
```

**`remove` (mutation):**
```typescript
export const remove = mutation({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) throw new Error("Project not found");
    const team = await ctx.db.get("teams", project.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("templateProjects", args.projectId);
  },
});
```

**`checkSlugAvailable` (query):**
```typescript
export const checkSlugAvailable = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("templateProjects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.toLowerCase()))
      .first();
    return !existing;
  },
});
```

### 2. Verify

- Run `npm -s convex codegen` to regenerate types after creating the new file
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/templates.ts` | **Create** | Template project CRUD: `listByTeam`, `get`, `create`, `updateStatus`, `remove`, `checkSlugAvailable` |

## Acceptance Criteria

1. `convex/templates.ts` exists with all 6 functions
2. `listByTeam` requires team membership and returns all template projects for a team
3. `get` requires team membership and returns a single template project
4. `create` requires owner role, validates slug uniqueness, validates deploy key ownership, creates project in "provisioning" state
5. `updateStatus` can update status and optionally set Convex project details (for use by provisioning actions)
6. `remove` requires owner role and deletes the template project
7. `checkSlugAvailable` checks if a slug is already taken in our system
8. `npm -s convex codegen` succeeds
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `create` mutation creates the project record in "provisioning" state. The actual Convex API calls (project creation, deploy key generation) and Fly.io provisioning will be handled by a separate action in a future task. This separation keeps the mutation fast and lets the action handle the async external API calls.
- The `updateStatus` mutation is intentionally not auth-gated because it will be called from server-side actions (internal). If Convex supports internal mutations, use that pattern. Otherwise, keep it as-is since only server-side code will call it.
- Slug validation is done locally (checking our `templateProjects` table). Checking slug availability against the Convex API is a future task.
- The `flyioDeployKey` stored on the template project is copied from the `flyioDeployKeys` table entry at creation time, so the project retains a reference even if the original key is later deleted.
- Follow the same patterns as `convex/projects.ts` and `convex/deployKeys.ts` for consistency.
- Use `v.id("flyioDeployKeys")` to reference the deploy key, not a raw string.

## Implementation Summary

### Files Created
| File | Description |
|------|-------------|
| `convex/templates.ts` | Template project CRUD with 6 functions |

### What Was Built
- **`listByTeam` (query)** — Lists all template projects for a team, requires team membership
- **`get` (query)** — Gets a single template project by ID, requires team membership
- **`create` (mutation)** — Creates a template project in "provisioning" state; validates owner role, slug uniqueness, and deploy key ownership
- **`updateStatus` (mutation)** — Updates project status and optionally sets Convex project details (for provisioning actions)
- **`remove` (mutation)** — Deletes a template project, requires owner role
- **`checkSlugAvailable` (query)** — Checks if a slug is already taken in the templateProjects table

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed
- Browser test — app loads correctly, no regressions

### Reviewer Notes (d702ea08)
Reviewed `convex/templates.ts` — no issues found. All 6 functions (listByTeam, get, create, updateStatus, remove, checkSlugAvailable) are correctly implemented. Auth checks, index usage, and schema alignment are all correct. TypeScript compiles cleanly. Generated API types include the templates module. No fixes needed.
