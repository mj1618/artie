# Task: Add Fly.io Deploy Key Management (Backend + UI)

## Context

Phase 6 requires users to provide Fly.io deploy keys for server-side runtime and template project creation. The `flyioDeployKeys` table already exists in `convex/schema.ts` (lines 126-135) with `by_teamId` and `by_userId` indexes, but there are **no backend functions** to manage keys and **no UI** for users to add, view, or delete them.

This task adds CRUD backend functions and a "Fly.io Deploy Keys" management section to the team settings page. This is a prerequisite for template creation and external Convex connection flows.

### What exists now:
- `convex/schema.ts` — `flyioDeployKeys` table with fields: `teamId`, `userId`, `name`, `encryptedKey`, `createdAt`, `lastUsedAt`; indexes `by_teamId` and `by_userId`
- `convex/projects.ts` — Repo CRUD but no deploy key functions
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Team management page (members, invites)
- `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` — LLM provider config (owner only)

### What's missing:
- Backend mutations: `addDeployKey`, `listDeployKeys`, `deleteDeployKey` in a new `convex/deployKeys.ts` file
- UI: A "Fly.io Deploy Keys" section accessible from team settings (new page at `src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx`)
- Navigation link to deploy keys page from the team page or sidebar

## Requirements

### 1. Create `convex/deployKeys.ts` with CRUD functions

Create a new file with these functions:

**`listByTeam` (query):**
```typescript
export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    // Verify team membership
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", args.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];
    // Only owners can see deploy keys
    if (membership.role !== "owner") return [];
    const keys = await ctx.db
      .query("flyioDeployKeys")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
    // Return keys WITHOUT the encryptedKey field (never send secrets to client)
    return keys.map((k) => ({
      _id: k._id,
      name: k.name,
      userId: k.userId,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  },
});
```

**`addDeployKey` (mutation):**
```typescript
export const addDeployKey = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    key: v.string(), // raw key — will be stored as-is for now (encryption in later task)
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    return await ctx.db.insert("flyioDeployKeys", {
      teamId: args.teamId,
      userId,
      name: args.name.trim(),
      encryptedKey: args.key, // TODO: encrypt with AES-256 in a later task
      createdAt: Date.now(),
    });
  },
});
```

**`deleteDeployKey` (mutation):**
```typescript
export const deleteDeployKey = mutation({
  args: { keyId: v.id("flyioDeployKeys") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const key = await ctx.db.get("flyioDeployKeys", args.keyId);
    if (!key) throw new Error("Key not found");
    const team = await ctx.db.get("teams", key.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("flyioDeployKeys", args.keyId);
  },
});
```

### 2. Create deploy keys page at `src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx`

Build a "Fly.io Deploy Keys" page (owner-only) with:

- Page header: "Fly.io Deploy Keys" with description "Manage deploy keys for server-side runtime environments."
- **Key list**: Table/list showing existing keys with columns: Name, Added date, Last used, Delete button
- **Add key form**: Input fields for "Key Name" (text) and "Deploy Key" (password input), plus an "Add Key" button
- Empty state when no keys: "No deploy keys added yet. Add a Fly.io deploy key to enable server-side runtime for your projects."
- Use the same styling patterns as the LLM settings page and team page (zinc-800 borders, zinc-900 bg cards)
- Owner-only access check — if user is not owner, show "Only team owners can manage deploy keys."
- Use `useToast` for success/error feedback
- Use confirmation before deleting a key

### 3. Add navigation to the deploy keys page

In the team page (`src/app/(dashboard)/team/[teamId]/page.tsx`), add a link/button to the deploy keys page, similar to how the LLM settings link works. Something like:

```tsx
<a href={`/team/${teamId}/deploy-keys`} className="...">
  Manage Fly.io Deploy Keys
</a>
```

Also check if the sidebar (`src/components/layout/Sidebar.tsx`) should include a link — but only add it if the team pages already have sidebar links. Otherwise just use the team page link.

### 4. Verify

- Run `npx convex dev --once` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/deployKeys.ts` | **Create** | CRUD functions: `listByTeam` (query), `addDeployKey` (mutation), `deleteDeployKey` (mutation) |
| `src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx` | **Create** | Deploy keys management page with list, add form, delete button |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add navigation link to deploy keys page |

## Acceptance Criteria

1. `convex/deployKeys.ts` has `listByTeam`, `addDeployKey`, and `deleteDeployKey` functions
2. `listByTeam` never returns the `encryptedKey` field to the client
3. Only team owners can add/delete deploy keys (authorization checks in all functions)
4. Deploy keys page shows a list of existing keys (name, date added, last used)
5. Deploy keys page has a form to add a new key (name + key inputs)
6. Users can delete keys with a confirmation step
7. The team page has a navigation link to the deploy keys page
8. Toast notifications for success/error states
9. `npx convex dev --once` succeeds
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `encryptedKey` field currently stores the raw key. AES-256 encryption will be added in a separate task — don't block on it.
- Deploy keys are team-scoped and owner-only for management. Members should not see or manage deploy keys.
- The `key` argument in `addDeployKey` is the raw Fly.io deploy token. The password input field prevents shoulder-surfing.
- Follow the same page structure and styling as `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` for consistency.
- Use `v.id("flyioDeployKeys")` for the delete mutation arg, not `v.string()`.

---

## Completion Summary

### Files Created
- `convex/deployKeys.ts` — CRUD functions: `listByTeam` (query), `addDeployKey` (mutation), `deleteDeployKey` (mutation). `listByTeam` never returns `encryptedKey` to client. All functions enforce owner-only authorization.
- `src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx` — Deploy keys management page with key list (name, date added, last used), add key form (name + password input), empty state, delete with ConfirmDialog, toast notifications, and owner-only access check.

### Files Modified
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Added "Fly.io Deploy Keys" navigation link in the Settings section, with description "Manage deploy keys for server-side runtime".
- `src/components/layout/Sidebar.tsx` — Added "Deploy Keys" link under each team, next to "LLM Settings".

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed with zero errors
- Browser tested: page renders, add key works (with toast), delete key works (with confirmation dialog and toast), empty state displays correctly, sidebar and team page links navigate correctly.

### Reviewer Notes (4acf2091)
Reviewed all 4 files (created + modified). No issues found:

- **`convex/deployKeys.ts`**: Auth checks correct (owner-only for all 3 functions). `listByTeam` correctly strips `encryptedKey` from responses. Index usage (`by_teamId`, `by_teamId_userId`) correct. Schema fields align with `flyioDeployKeys` table definition.
- **`src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx`**: `"use client"` present. All imports resolve (`@/lib/useToast`, `@/components/ui/ConfirmDialog`, relative convex imports at correct depth). Loading/null/not-found states handled. Owner-only guard works. ConfirmDialog props match interface. Password input type for key field. Form disables submit when fields empty.
- **Team page**: Deploy keys link added consistently alongside LLM Settings in the Settings section.
- **Sidebar**: Deploy Keys link added under each team with correct active-state highlighting.
- `npx tsc --noEmit` passes cleanly. `npx convex codegen` passes.
- No fixes needed.
