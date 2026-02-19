# Task: Add Firecracker VM Schema and Core Backend Module

## What to Build

Add the `firecrackerVms` table to the Convex schema and create the core `convex/firecrackerVms.ts` backend module with queries, mutations, and actions for managing Firecracker VMs. Also add `"firecracker"` to the runtime union in the `repos` table.

This is the foundational backend work that the frontend and scheduler will depend on.

## Files to Create/Modify

### Modify: `convex/schema.ts`

1. **Add `"firecracker"` to the `runtime` union** in the `repos` table (line ~54):
   ```typescript
   runtime: v.optional(v.union(
     v.literal("webcontainer"),
     v.literal("flyio-sprite"),
     v.literal("sandpack"),
     v.literal("digitalocean-droplet"),
     v.literal("firecracker")  // ADD THIS
   )),
   ```

2. **Add the `firecrackerVms` table** after the `dropletQuotas` table. Follow the schema from `swarm/epics/firecracker.todo.md` Phase 2.1 exactly. Key fields:
   - `sessionId`, `repoId`, `teamId`, `userId` — identifiers
   - `vmId`, `vmName`, `vmIp` — host API metadata
   - `hostPort`, `previewUrl`, `logsUrl`, `terminalUrl` — URLs
   - `status` — state machine with states: `requested`, `creating`, `booting`, `cloning`, `installing`, `starting`, `ready`, `active`, `stopping`, `destroying`, `destroyed`, `unhealthy`
   - `apiSecret` — for status callbacks
   - `errorMessage`, `retryCount`, `lastRetryAt` — error handling
   - Timestamps: `createdAt`, `statusChangedAt`, `lastHeartbeatAt`, `destroyedAt`
   - `statusHistory` — audit trail array
   - `branch` — repo branch context
   - Indexes: `by_sessionId`, `by_repoId`, `by_repoId_branch`, `by_teamId`, `by_vmId`, `by_vmName`, `by_status`

### Create: `convex/firecrackerVms.ts`

Follow the pattern from `convex/droplets.ts`. Create:

1. **Constants**: `FIRECRACKER_HOST`, `TIMEOUTS` object
2. **Internal query**: `getByIdInternal` — get VM record by Convex doc ID
3. **Internal mutation**: `updateStatus` — update VM status with history entry
4. **Internal mutation**: `updateStatusFromHost` — called by HTTP callback, validates `apiSecret`
5. **Authenticated query**: `getForSession` — get current VM for a session
6. **Authenticated query**: `getForRepo` — get active VM for a repo+branch
7. **Authenticated mutation**: `request` — create a new VM request (inserts record with status "requested")
8. **Authenticated mutation**: `requestStop` — transition VM to "stopping"
9. **Authenticated mutation**: `heartbeat` — update `lastHeartbeatAt`, transition "ready" -> "active"
10. **Internal action**: `createVm` — call Firecracker host API `POST /api/vms` to create a VM
11. **Internal action**: `setupVm` — call Firecracker host API `POST /api/vms/:id/setup` to clone repo and start dev server
12. **Internal action**: `destroyVm` — call Firecracker host API `DELETE /api/vms/:id`

### Modify: `convex/http.ts`

Add the `/firecracker-status` HTTP endpoint for VM status callbacks from the Firecracker host.

## Environment Variables Needed

These should already be configured or will be configured in Convex dashboard:
- `FIRECRACKER_HOST_URL` = `http://157.230.181.26:8080`
- `FIRECRACKER_API_SECRET` = `23c17c1952fa688c07da3f738e1058d83624cad71c91e1ccf4172049f80cb5f5`

## How to Verify

1. Run `npx convex dev --once` — schema should push successfully with no errors
2. Run `npx tsc -p tsconfig.json --noEmit` — no TypeScript errors
3. The `firecrackerVms` table should appear in the Convex dashboard
4. All exported functions should be available in the `api` and `internal` objects

## Key Patterns to Follow

- Follow `convex/droplets.ts` patterns for state machine, status history, and action structure
- Use `getAuthUserId` from `@convex-dev/auth/server` for authenticated endpoints
- Use `internal.*` for internal functions, `api.*` for client-facing functions
- Helper function `getUserGithubTokenById` from `convex/droplets.ts` can be reused for getting GitHub tokens in setup action
- Use `crypto.randomUUID()` for generating `apiSecret`

---

## Completion Summary

### Files Modified
- **`convex/schema.ts`** — Added `"firecracker"` to the `runtime` union in the `repos` table, and added the full `firecrackerVms` table with all specified fields and 7 indexes.
- **`convex/http.ts`** — Added `/firecracker-status` HTTP POST endpoint for VM status callbacks from the Firecracker host. Validates `vmName`, `callbackSecret`, and `status` fields.
- **`convex/projects.ts`** — Added `"firecracker"` to the `runtime` validator in `updateRepo` mutation and the updates type literal.
- **`src/components/preview/PreviewPanel.tsx`** — Added `"firecracker"` to `RuntimeType` union.
- **`src/components/chat/ChatPanel.tsx`** — Added `"firecracker"` to `Runtime` type union.
- **`src/app/(dashboard)/repos/[repoId]/settings/page.tsx`** — Added `"firecracker"` to the runtime state type.

### Files Created
- **`convex/firecrackerVms.ts`** — Full backend module with:
  - Constants: `FIRECRACKER_HOST`, `TIMEOUTS`
  - Internal query: `getByIdInternal`
  - Internal queries: `getByStatus` (for scheduler)
  - Authenticated queries: `getForSession`, `getForRepo`
  - Authenticated mutations: `request`, `requestStop`, `heartbeat`
  - Internal mutations: `updateStatus` (with state machine validation), `updateStatusFromHost` (validates apiSecret)
  - Internal actions: `createVm`, `setupVm`, `destroyVm`
  - Helper functions: `generateVmName`, `generateApiSecret`, `getUserGithubTokenById`, `refreshGithubToken`

### Verification
- `npx convex dev --once` — Schema pushed successfully, all 7 indexes created
- `npx tsc -p tsconfig.json --noEmit` — No new TypeScript errors (pre-existing errors in pull-requests pages unrelated to this change)
- Browser test — App loads correctly, settings page renders, no runtime errors

---

## Review (ae353a5b)

### Issues Found and Fixed

1. **`convex/firecrackerVms.ts` — `destroyVm` action skipped `destroying` state transition (BUG)**
   - The `destroyVm` action was transitioning directly from `stopping` to `destroyed`, but the state machine only allows `stopping -> destroying -> destroyed`.
   - The `updateStatus` mutation would have rejected this transition as invalid.
   - **Fix**: Added an initial transition to `"destroying"` before the host API call, then transition to `"destroyed"` after cleanup completes. Matches the `droplets.ts` pattern.

2. **`src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Runtime display didn't handle all runtimes**
   - The runtime info display only handled `"webcontainer"`, `"sandpack"`, and `"flyio-sprite"`, falling through to `"Fly.io Sprite (server)"` for `"digitalocean-droplet"` and `"firecracker"`.
   - **Fix**: Added proper display labels for `"digitalocean-droplet"` ("DigitalOcean Droplet (server)") and `"firecracker"` ("Firecracker VM (server)").

3. **`src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Missing Firecracker radio button in settings form**
   - The runtime configuration form had radio buttons for webcontainer, sandpack, flyio-sprite, and digitalocean-droplet, but was missing the firecracker option.
   - **Fix**: Added "Firecracker VM (server)" radio button option.

### Notes (No Fix Needed)
- `PreviewPanel.tsx`: `"firecracker"` falls through to WebContainer rendering — this is expected since the `FirecrackerPreview` component will be built in a separate task.
- `ChatPanel.tsx`: `"firecracker"` falls through to WebContainer for file changes/bash commands — same as above, frontend integration is a separate task.
- TypeScript compilation: Only pre-existing errors in pull-requests pages (unrelated to this change).
