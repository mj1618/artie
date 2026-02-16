# Task: Add Phase 6 Schema Tables and Runtime Selection to Repos

## Context

Phase 6 (External Convex & Templates) is entirely unbuilt. Before any UI or backend logic can be implemented, the data model needs to be extended with the tables described in PLAN.md. Additionally, the `repos` table is missing the `runtime` field that controls whether a project uses WebContainers or Fly.io Sprite.

This task adds the foundational schema changes and wires the runtime field into the existing repo settings page. It does NOT build any Fly.io integration or template creation flows — those come in subsequent tasks.

### What exists now:
- `convex/schema.ts` — Has `repos` table without `runtime` field. No `templateProjects` or `flyioDeployKeys` tables.
- `src/app/(dashboard)/settings/page.tsx` — Account settings page (not repo settings).
- Repo settings are configured during connection (push strategy) but the runtime field doesn't exist.

### What's missing (from PLAN.md data model):
- `repos` table needs: `runtime`, `hasConvex`, `projectType`, `externalConvexUrl`, `externalConvexDeployment` fields
- `templateProjects` table — for projects created from templates
- `flyioDeployKeys` table — for user-provided Fly.io deploy keys

## Requirements

### 1. Extend the `repos` table in `convex/schema.ts`

Add the following optional fields to the `repos` table definition:

```typescript
repos: defineTable({
  // ... existing fields ...
  runtime: v.optional(v.union(v.literal("webcontainer"), v.literal("flyio-sprite"))),
  hasConvex: v.optional(v.boolean()),
  projectType: v.optional(v.string()),
  externalConvexUrl: v.optional(v.string()),
  externalConvexDeployment: v.optional(v.string()),
}).index("by_teamId", ["teamId"]),
```

All new fields are `v.optional(...)` so existing repo documents don't need migration. The default runtime behavior (when `runtime` is undefined) should be WebContainers.

### 2. Add the `templateProjects` table

```typescript
templateProjects: defineTable({
  teamId: v.id("teams"),
  name: v.string(),
  slug: v.string(),
  template: v.literal("nextjs-convex"),
  createdBy: v.string(),
  createdAt: v.number(),
  convexProjectId: v.string(),
  convexDeploymentUrl: v.string(),
  convexDeployKey: v.string(),
  flyioAppName: v.string(),
  flyioDeployKey: v.string(),
  status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("error")),
  errorMessage: v.optional(v.string()),
})
  .index("by_teamId", ["teamId"])
  .index("by_slug", ["slug"]),
```

### 3. Add the `flyioDeployKeys` table

```typescript
flyioDeployKeys: defineTable({
  teamId: v.id("teams"),
  userId: v.string(),
  name: v.string(),
  encryptedKey: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
})
  .index("by_teamId", ["teamId"])
  .index("by_userId", ["userId"]),
```

### 4. Add runtime selection to the repo connection flow

In the backend function that connects a repo (likely in `convex/projects.ts` or wherever `connectRepo` lives), accept an optional `runtime` argument and store it. Default to `"webcontainer"` if not provided.

Find the repo connection mutation and add `runtime` to its args:

```typescript
runtime: v.optional(v.union(v.literal("webcontainer"), v.literal("flyio-sprite"))),
```

### 5. Show runtime in repo settings / workspace header

This is stretch for this task. If the repo connection flow already has a settings step, add a radio/toggle for runtime selection. If not, just make sure the schema is correct and move on — a separate task will build the UI.

### 6. Run codegen and verify

- Run `npm -s convex codegen` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `runtime`, `hasConvex`, `projectType`, `externalConvexUrl`, `externalConvexDeployment` to `repos`. Add `templateProjects` and `flyioDeployKeys` tables. |
| `convex/projects.ts` (or wherever repo connection lives) | **Modify** | Add optional `runtime` arg to the connect/update mutation. |

## Acceptance Criteria

1. `convex/schema.ts` includes the `repos` table with new optional fields (`runtime`, `hasConvex`, `projectType`, `externalConvexUrl`, `externalConvexDeployment`)
2. `convex/schema.ts` includes the `templateProjects` table with all fields from PLAN.md
3. `convex/schema.ts` includes the `flyioDeployKeys` table with all fields from PLAN.md
4. Both new tables have appropriate indexes (`by_teamId`, `by_slug`, `by_userId`)
5. Existing functionality is not broken — all new fields on `repos` are optional
6. `npm -s convex codegen` succeeds
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- All new fields on `repos` MUST be `v.optional(...)` to avoid breaking existing documents
- The `runtime` field defaults to WebContainers behavior when undefined — no migration needed
- The `flyioDeployKeys.encryptedKey` field stores AES-256 encrypted keys (encryption logic comes in a later task)
- The `templateProjects.template` field uses `v.literal("nextjs-convex")` — more templates can be added later by changing to `v.union(...)`
- This is a schema-only task. No UI for template creation or Fly.io deploy key management. Those are separate tasks that build on this foundation.

## Completion Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/schema.ts` | Added 5 optional fields to `repos` table (`runtime`, `hasConvex`, `projectType`, `externalConvexUrl`, `externalConvexDeployment`). Added `templateProjects` table with `by_teamId` and `by_slug` indexes. Added `flyioDeployKeys` table with `by_teamId` and `by_userId` indexes. |
| `convex/projects.ts` | Added optional `runtime` arg to `addRepo` mutation (defaults to `"webcontainer"`). Added optional `runtime` arg to `updateRepo` mutation. |

### What Was Built
- Extended the `repos` table with all Phase 6 fields as optional values — no migration needed for existing documents
- Added `templateProjects` table for future template project creation flows
- Added `flyioDeployKeys` table for future Fly.io deploy key management
- Wired `runtime` into both `addRepo` (with default `"webcontainer"`) and `updateRepo` mutations
- Convex codegen succeeded, TypeScript compilation passes (only pre-existing errors in another worker's in-progress file)
- Browser verified: app loads correctly, home page renders with all teams/repos/sessions

## Review (fd1dbe05)

### Issues Found & Fixed
- **`convex/projects.ts` line 111**: `updateRepo` used `Record<string, string>` for the `updates` object, which loses type specificity for union-typed fields (`pushStrategy`, `runtime`). Fixed to use `Partial<{ pushStrategy: "direct" | "pr"; defaultBranch: string; runtime: "webcontainer" | "flyio-sprite" }>` for proper type safety.

### Verified
- `convex/schema.ts`: All new fields on `repos` are correctly `v.optional(...)`. `templateProjects` and `flyioDeployKeys` tables have correct field types and indexes.
- `convex/projects.ts`: `addRepo` correctly defaults `runtime` to `"webcontainer"`. `updateRepo` correctly handles optional partial updates.
- New tables (`templateProjects`, `flyioDeployKeys`) are only referenced in the schema — no broken imports elsewhere.
- Convex codegen succeeds.
- `npx tsc -p tsconfig.json --noEmit` passes with zero errors.
