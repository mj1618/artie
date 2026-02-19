# Task: Firecracker VM Scheduler & Cron Jobs

## What to Build

Create `convex/firecrackerScheduler.ts` — a lifecycle scheduler for Firecracker VMs — and add corresponding cron jobs to `convex/crons.ts`. This handles automatic processing of VM requests, heartbeat monitoring, timeout detection, stopping/cleanup, and old record cleanup.

Follow the pattern from `convex/dropletScheduler.ts` but adapted for Firecracker VMs with faster intervals (Firecracker VMs boot in <1s vs ~60s for droplets).

## Files to Create

### `convex/firecrackerScheduler.ts`

Implement these exported functions (all `internalMutation` or `internalAction`):

1. **`processRequested`** — Pick up VMs in `"requested"` status, transition to `"creating"`, and schedule `internal.firecrackerVms.createVm`. Process up to 5 at a time.

2. **`checkHeartbeats`** — Find `"active"` VMs with stale heartbeats. If heartbeat > `TIMEOUTS.heartbeat_stop` (5 min), transition to `"stopping"`. If > `TIMEOUTS.heartbeat_warning` (1 min), demote to `"ready"`. Also check `"ready"` VMs with no activity for too long.

3. **`checkTimeouts`** — Find VMs stuck in transitional states (`"creating"`, `"booting"`, `"cloning"`, `"installing"`, `"starting"`) longer than their respective timeout. Mark them `"unhealthy"` with a descriptive error.

4. **`processStopping`** — Pick up VMs in `"stopping"` status, transition to `"destroying"`, and schedule `internal.firecrackerVms.destroyVm`.

5. **`processUnhealthy`** — Pick up VMs in `"unhealthy"` status, transition to `"destroying"`, and schedule `internal.firecrackerVms.destroyVm`.

6. **`cleanupOldRecords`** — Delete `"destroyed"` VM records older than 24 hours.

### Supporting queries needed in `convex/firecrackerVms.ts`

The scheduler needs a helper query. Add:

- **`getTimedOutVms`** (`internalQuery`) — query VMs by status where `statusChangedAt` is older than a threshold. Uses the `by_status` index + filter on `statusChangedAt`.
- **`deleteOldDestroyed`** (`internalMutation`) — delete destroyed records older than a cutoff timestamp.

Note: Firecracker does NOT need a `reconcile` action (unlike droplets) because there's no external API to reconcile against — the host API is simple and VMs are ephemeral. Skip this for now.

Note: Firecracker does NOT have a `create_failed` state (unlike droplets). Failed creates go straight to `"unhealthy"`. So no `processCreateFailed` is needed.

### `convex/crons.ts`

Add firecracker cron jobs after the existing droplet ones. Use faster intervals since Firecracker VMs are much quicker:

```typescript
// Firecracker scheduler jobs (faster than droplets)
crons.interval("firecracker:processRequested", { seconds: 5 }, internal.firecrackerScheduler.processRequested);
crons.interval("firecracker:checkHeartbeats", { seconds: 30 }, internal.firecrackerScheduler.checkHeartbeats);
crons.interval("firecracker:checkTimeouts", { seconds: 15 }, internal.firecrackerScheduler.checkTimeouts);
crons.interval("firecracker:processStopping", { seconds: 10 }, internal.firecrackerScheduler.processStopping);
crons.interval("firecracker:processUnhealthy", { seconds: 30 }, internal.firecrackerScheduler.processUnhealthy);
crons.interval("firecracker:cleanupOldRecords", { hours: 1 }, internal.firecrackerScheduler.cleanupOldRecords);
```

## Key Differences from Droplet Scheduler

- **Faster intervals**: `processRequested` every 5s (vs 10s), `checkTimeouts` every 15s (vs 30s), `processStopping` every 10s (vs 30s)
- **No `processCreateFailed`**: Firecracker goes straight to `unhealthy` on failure
- **No `reconcile`**: No external cloud API to reconcile against
- **Different TIMEOUTS**: Import from `./firecrackerVms` instead of `./droplets`
- **Different field names**: Uses `vmId` (not `dropletId`), references `internal.firecrackerVms.*` (not `internal.droplets.*`)
- **Transitional states include `"starting"`**: Firecracker has `creating → booting → cloning → installing → starting → ready` (droplets skip `starting`)

## How to Verify

1. Run `npx convex dev --once` — should codegen successfully with no type errors
2. Run `npx tsc -p tsconfig.json --noEmit` — no frontend TS errors
3. Check that all cron job references resolve to actual exported functions
4. Check that `getTimedOutVms` and `deleteOldDestroyed` are properly exported from `firecrackerVms.ts`

---

## Completion Summary

### Files Created
- **`convex/firecrackerScheduler.ts`** — Full lifecycle scheduler with 6 exported `internalMutation` functions:
  - `processRequested` — picks up VMs in "requested" status (up to 5), transitions to "creating", schedules `createVm`
  - `checkHeartbeats` — monitors "active" VMs for stale heartbeats (demote to "ready" or "stopping"), checks "ready" VMs for inactivity
  - `checkTimeouts` — detects VMs stuck in transitional states (creating, booting, cloning, installing, starting) past their timeout, marks "unhealthy"
  - `processStopping` — picks up "stopping" VMs (up to 10), transitions to "destroying", schedules `destroyVm`
  - `processUnhealthy` — picks up "unhealthy" VMs (up to 10), transitions to "destroying", schedules `destroyVm`
  - `cleanupOldRecords` — deletes "destroyed" records older than 24 hours

### Files Modified
- **`convex/firecrackerVms.ts`** — Added two helper functions for the scheduler:
  - `getTimedOutVms` (internalQuery) — queries VMs by status with `statusChangedAt` older than threshold, uses `by_status_and_statusChangedAt` index
  - `deleteOldDestroyed` (internalMutation) — deletes destroyed records older than cutoff, uses `by_status_and_statusChangedAt` index
- **`convex/schema.ts`** — Added `by_status_and_statusChangedAt` index to `firecrackerVms` table (needed for efficient timeout and cleanup queries)
- **`convex/crons.ts`** — Added 6 firecracker cron jobs with faster intervals than droplets:
  - `firecracker:processRequested` every 5s
  - `firecracker:checkHeartbeats` every 30s
  - `firecracker:checkTimeouts` every 15s
  - `firecracker:processStopping` every 10s
  - `firecracker:processUnhealthy` every 30s
  - `firecracker:cleanupOldRecords` every 1h

### Verification
- `npx convex dev --once` — codegen succeeded, new index `firecrackerVms.by_status_and_statusChangedAt` added
- `npx tsc -p tsconfig.json --noEmit` — no new TypeScript errors (only pre-existing errors in pull-requests pages)
- Browser test — app loads correctly, login works, dashboard renders properly
