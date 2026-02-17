# Task: Add Template Project Provisioning Action

## Context

Phase 6 includes creating applications from templates. The `templates.create` mutation creates a `templateProjects` record in "provisioning" state, but nothing happens after that — the project stays stuck in "provisioning" forever. We need a Convex action that kicks off after creation and transitions the project to "active" (or "error").

For now, this action will **simulate** provisioning (since real Convex API and Fly.io API integration requires production credentials and is a separate concern). The action will:
1. Be called right after `templates.create` succeeds (from the frontend)
2. Simulate a brief delay (to mimic real provisioning)
3. Update the project with placeholder Convex project details
4. Set status to "active"

This gives us a complete end-to-end flow: create → provisioning → active, which unblocks the rest of the template project UX.

### What exists now:
- `convex/templates.ts` — `create` (mutation, sets status to "provisioning"), `updateStatus` (mutation), `get`, `listByTeam`, `remove`, `checkSlugAvailable`
- `convex/github.ts` and `convex/ai.ts` — examples of `"use node"` actions in the codebase
- The `create` mutation stores placeholder empty strings for `convexProjectId`, `convexDeploymentUrl`, `convexDeployKey`

### What's missing:
- A `provisionProject` action in `convex/templates.ts` that simulates provisioning and transitions the project to "active"
- The template selection UI (being built by another task) needs to call this action after a successful `create`

## Requirements

### 1. Add `provisionProject` action to `convex/templates.ts`

Change the file to include `"use node"` at the top (required for actions that use `fetch` or timers), and add:

```typescript
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const provisionProject = action({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    // 1. Get the project to verify it exists and is in provisioning state
    const project = await ctx.runQuery(api.templates.get, { projectId: args.projectId });
    if (!project) throw new Error("Project not found");
    if (project.status !== "provisioning") throw new Error("Project is not in provisioning state");

    try {
      // 2. Simulate provisioning delay (1-2 seconds)
      // In production, this would:
      //   - Call Convex API to create a new project with the slug
      //   - Generate a Convex deploy key for the new project
      //   - Call Fly.io API to provision a Sprite with the deploy key
      //   - Set up environment variables on the Fly.io Sprite
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 3. Generate placeholder values (simulating what the APIs would return)
      const convexProjectId = `proj_${project.slug}_${Date.now()}`;
      const convexDeploymentUrl = `https://${project.slug}.convex.cloud`;
      const convexDeployKey = `deploy:${project.slug}:placeholder`;

      // 4. Update the project to active with the simulated values
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "active",
        convexProjectId,
        convexDeploymentUrl,
        convexDeployKey,
      });
    } catch (error) {
      // 5. On failure, set status to error
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown provisioning error",
      });
      throw error;
    }
  },
});
```

**Important**: Since `templates.ts` currently uses only `query` and `mutation` from `./_generated/server`, you'll need to also import `action`. And since actions need `"use node"`, add that directive at the top of the file. Wait — actually, `"use node"` makes the entire file run in the Node.js runtime, which is fine for queries/mutations too. But if the existing queries/mutations are working without `"use node"`, it may be better to put the action in a separate file.

**Decision**: Create the action in a **new file** `convex/templateActions.ts` with `"use node"` at the top, to avoid affecting the existing queries/mutations in `convex/templates.ts`. This follows the same pattern as having `convex/github.ts` (actions) separate from `convex/projects.ts` (queries/mutations).

### 2. Create `convex/templateActions.ts`

```typescript
"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const provisionProject = action({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    // Get the project to verify it exists and is in provisioning state
    const project = await ctx.runQuery(api.templates.get, { projectId: args.projectId });
    if (!project) throw new Error("Project not found");
    if (project.status !== "provisioning") throw new Error("Project is not in provisioning state");

    try {
      // Simulate provisioning delay
      // In production, this would call Convex API + Fly.io API
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Generate placeholder values
      const convexProjectId = `proj_${project.slug}_${Date.now()}`;
      const convexDeploymentUrl = `https://${project.slug}.convex.cloud`;
      const convexDeployKey = `deploy:${project.slug}:placeholder`;

      // Update the project to active
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "active",
        convexProjectId,
        convexDeploymentUrl,
        convexDeployKey,
      });

      return { success: true };
    } catch (error) {
      // On failure, set status to error
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown provisioning error",
      });
      throw error;
    }
  },
});
```

### 3. Update the template creation UI to call the provisioning action

The template selection UI task (`2026-02-15-20-10-00-add-template-selection-ui-to-dashboard.todo.md`) is being built in parallel. The worker implementing that task should call the provisioning action after `templates.create` succeeds. If the template UI task is already done by the time this task runs, modify the creation handler in `src/app/(dashboard)/home/page.tsx` to add:

```typescript
// After templates.create succeeds:
const projectId = await createTemplate({ ... });
// Fire-and-forget: start provisioning in the background
provisionProject({ projectId }).catch(console.error);
```

If the template UI isn't built yet, just ensure the action exists and works — the UI integration can be done when the UI task picks it up or in a follow-up task.

### 4. Verify

- Run `npx convex dev --once` to regenerate types (the new `templateActions.ts` file needs to be picked up)
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/templateActions.ts` | **Create** | `provisionProject` action that simulates provisioning and transitions template project from "provisioning" to "active" |
| `src/app/(dashboard)/home/page.tsx` | **Modify** (if template UI exists) | Call `api.templateActions.provisionProject` after successful template creation |

## Acceptance Criteria

1. `convex/templateActions.ts` exists with a `provisionProject` action
2. The action validates the project exists and is in "provisioning" state
3. The action simulates a brief delay, then updates the project with placeholder Convex details
4. The action sets status to "active" on success
5. The action sets status to "error" with an error message on failure
6. If the template creation UI exists in `home/page.tsx`, it calls the provisioning action after creating a project
7. `npx convex dev --once` succeeds
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `provisionProject` action is in a separate file (`convex/templateActions.ts`) from `convex/templates.ts` to keep the `"use node"` directive isolated. This prevents queries/mutations from unnecessarily running in the Node.js environment.
- The `templates.get` query requires authentication, so the action must be called from an authenticated context (which it will be, since `ctx.runQuery` inherits the caller's auth).
- The 1.5-second simulated delay gives the UI a realistic feel for the provisioning flow. In production, this would be replaced with real API calls that take real time.
- The provisioning action is designed to be called fire-and-forget from the UI — the project will update reactively via the `listByTeam` query when it transitions to "active".
- Error handling wraps the entire provisioning flow and updates the project status to "error" so the UI can display a meaningful message.
- Future task: Replace simulated provisioning with real Convex API + Fly.io API calls using `CONVEX_ACCESS_TOKEN` and the user's Fly.io deploy key.

## Completion Summary

### Files Created
- `convex/templateActions.ts` — New `"use node"` action file with `provisionProject` action that simulates provisioning (1.5s delay), generates placeholder Convex project details, and transitions a `templateProject` from "provisioning" to "active" (or "error" on failure).

### Files Modified
- `src/app/(dashboard)/home/page.tsx` — Added `useAction` import, wired `provisionProject` to fire-and-forget after `templates.create` succeeds in `CreateTemplateDialog`.

### What Was Built
- Complete end-to-end template provisioning flow: create → provisioning → active
- The `provisionProject` action validates the project exists and is in "provisioning" state before proceeding
- On success: sets status to "active" with placeholder convexProjectId, convexDeploymentUrl, convexDeployKey
- On failure: sets status to "error" with error message
- UI integration calls the action fire-and-forget after creation, so the dialog closes immediately and the project status updates reactively

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed (zero errors)
- Browser testing: Dashboard renders correctly, "Create from Template" dialog opens with all fields, no console errors

## Reviewer Notes (agent 6efacc23)

Reviewed all created/modified files. No issues found:
- `convex/templateActions.ts`: Clean action with proper `"use node"` directive, validation, and error handling. Schema fields align correctly.
- `src/app/(dashboard)/home/page.tsx`: `"use client"` present, `useAction` import correct, fire-and-forget pattern with `.catch(console.error)` is appropriate, loading/error states handled.
- TypeScript compiles cleanly, Convex codegen passes, all imports resolve correctly. No fixes needed.

## Reviewer Notes (agent a6549557)

### Issues Found & Fixed

1. **Fixed broken imports in `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx`** — The file used `@/convex/_generated/api` and `@/convex/_generated/dataModel`, but the `@/` alias maps to `./src/`, not the project root. The convex generated files live at `./convex/_generated/`, not `./src/convex/_generated/`. Changed to relative imports (`../../../../../../../convex/_generated/api` and `../../../../../../../convex/_generated/dataModel`) consistent with all other files in the project. This was causing two TS2307 errors.

### Verified Clean
- `convex/templateActions.ts` — correct `"use node"` directive, proper action structure, error handling looks good
- `convex/templates.ts` — all queries/mutations well-structured, proper auth checks, schema-compatible
- `src/app/(dashboard)/home/page.tsx` — has `"use client"`, correct imports, `useAction` properly used for fire-and-forget provisioning
- `ConfirmDialog` props in detail page match component interface
- `npx tsc -p tsconfig.json --noEmit` — passes with zero errors after fix
