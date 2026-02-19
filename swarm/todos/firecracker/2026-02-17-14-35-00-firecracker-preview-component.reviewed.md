# Task: Build FirecrackerPreview Frontend Component

## What to Build

Create the `FirecrackerPreview` component — the main frontend UI for previewing applications running on Firecracker VMs. This component has three tabs: **Preview** (iframe), **Logs** (SSE log streaming), and **Terminal** (xterm.js WebSocket). Also add a `getForPreview` query to the backend and wire the component into `PreviewPanel.tsx`.

Follow the pattern from `DropletPreview.tsx` closely. Key behavioral differences from droplets:
- Firecracker VMs boot much faster (~seconds vs ~minutes)
- Logs come via SSE from the host API (not polling a REST endpoint)
- Terminal uses WebSocket to the host API
- Status has a `"starting"` phase that droplets don't have

## Files to Create

### `src/components/preview/FirecrackerPreview.tsx`

Main component with three tabs (Preview, Logs, Terminal). Follow `DropletPreview.tsx` patterns:

1. **State & queries**:
   - Query `api.firecrackerVms.getForPreview` with `{ sessionId, repoId, branch }`
   - Call `api.firecrackerVms.request` on mount when `sessionId` is available
   - Call `api.firecrackerVms.heartbeat` every 30s when VM is `"ready"` or `"active"`
   - Call `api.firecrackerVms.requestStop` when user clicks Stop

2. **Status mapping** — Map VM statuses to display phases:
   - `requested` → "Queued"
   - `creating` → "Creating VM"
   - `booting` → "Booting VM"
   - `cloning` → "Cloning repository"
   - `installing` → "Installing dependencies"
   - `starting` → "Starting dev server"
   - `ready`/`active` → "Ready"

3. **Preview tab**: iframe pointing at `vm.previewUrl` with nav bar (back, forward, refresh, URL display, open in new tab). Same pattern as DropletPreview.

4. **Logs tab**: Connect to `vm.logsUrl` via `EventSource` (SSE). Show lines with timestamps, color-code errors/warnings/success. Auto-scroll with toggle. If the host API doesn't support SSE yet (Phase 1 not done), fall back to displaying status history from the VM record as a simple log.

5. **Terminal tab**: Connect to `vm.terminalUrl` via WebSocket. Use `@xterm/xterm` + `@xterm/addon-fit`. Show connection status indicator. **Note**: Check if `@xterm/xterm` is already a dependency — if not, the task should add it to package.json.

6. **Boot progress stepper**: Reuse the same visual stepper pattern from DropletPreview but with Firecracker-specific steps.

7. **Error state**: Show `vm.errorMessage` with retry button. Show status history in collapsible details.

8. **Stopped state**: Show "VM Stopped" with Start button.

9. **Stopping state**: Show "Stopping VM..." with spinner.

10. **No session state**: Show "Select or create a session to start the preview".

### Logo/branding

Use a flame/fire SVG icon for the Firecracker branding (instead of DigitalOcean logo). Use orange/amber color scheme for the Firecracker status bar and stepper icons (instead of blue for droplets).

## Files to Modify

### `convex/firecrackerVms.ts`

Add a `getForPreview` query (authenticated, exported via `api`) that combines the logic of `getForSession` and `getForRepo`:

```typescript
export const getForPreview = query({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // First check for a VM associated with this session
    const vmBySession = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (vmBySession && vmBySession.status !== "destroyed") {
      return vmBySession;
    }

    // If no session VM, check for VMs on the same repo+branch
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const vmsForBranch = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying")
        )
      )
      .collect();

    if (vmsForBranch.length === 0) return null;

    // Prefer ready/active VMs
    const readyVm = vmsForBranch.find(
      (vm) => vm.status === "ready" || vm.status === "active"
    );
    if (readyVm) return readyVm;

    // Otherwise return most recently created
    return vmsForBranch.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});
```

### `src/components/preview/PreviewPanel.tsx`

Add the Firecracker runtime routing. Change:
```tsx
// Currently firecracker falls through to WebContainer
```
To:
```tsx
import { FirecrackerPreview } from "./FirecrackerPreview";

// In PreviewPanel component, add before the WebContainer fallback:
if (runtime === "firecracker") {
  return <FirecrackerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
}
```

## Dependencies to Check

- `@xterm/xterm` — Check if already in package.json. If not, run `npm install @xterm/xterm @xterm/addon-fit`
- The Terminal tab should be a separate `FirecrackerTerminal` sub-component for clean code organization, but can be inline if simpler

## How to Verify

1. Run `npx convex dev --once` — codegen succeeds with new `getForPreview` query
2. Run `npx tsc -p tsconfig.json --noEmit` — no new TypeScript errors
3. Run `npm run dev` and navigate to a repo with `runtime: "firecracker"`:
   - Verify the FirecrackerPreview component renders (not WebContainer)
   - Verify the boot progress stepper appears while VM is provisioning
   - Verify the Preview tab shows the iframe when VM is ready
   - Verify the Logs tab connects/attempts to connect via SSE
   - Verify the Terminal tab renders (even if WebSocket connection fails — host API extensions aren't deployed yet)
   - Verify Stop button works and shows stopping state
   - Verify error state shows correctly with retry

## Important Notes

- Phase 1 (host API extensions) is NOT done yet, so the Logs SSE and Terminal WebSocket will fail to connect. That's expected. The component should handle connection errors gracefully (show "Connecting..." or "Connection failed" messages, not crash).
- The Preview iframe will also fail until VMs are actually running. The boot stepper and status display are the main things to verify work correctly.
- The `apiSecret` field is stored on the VM record. The DropletPreview accesses `droplet.apiSecret` directly — do the same for Firecracker VMs. Note: this means the secret is exposed to the frontend, which is the existing pattern.

---

## Completion Summary

### Files Created
- **`src/components/preview/FirecrackerPreview.tsx`** — Main component with three tabs (Preview, Logs, Terminal), boot progress stepper, error/stopped/stopping states, and orange/amber Firecracker branding. Includes sub-components: `FirecrackerLogs` (SSE streaming with status history fallback), `FirecrackerTerminal` (xterm.js WebSocket with dynamic imports), `BootProgressStepper` (7-step with Firecracker-specific phases), `FirecrackerLogo` (flame SVG icon).

### Files Modified
- **`convex/firecrackerVms.ts`** — Added `getForPreview` authenticated query that checks session VM first, then falls back to repo+branch lookup (prefers ready/active VMs).
- **`src/components/preview/PreviewPanel.tsx`** — Added import and routing for `FirecrackerPreview` when `runtime === "firecracker"`.

### Dependencies Added
- `@xterm/xterm` and `@xterm/addon-fit` — for the Terminal tab WebSocket terminal.

### What Was Built
- Full `FirecrackerPreview` component following `DropletPreview.tsx` patterns with Firecracker-specific adaptations:
  - Orange/amber color scheme (vs blue for DigitalOcean)
  - Flame SVG icon branding
  - Additional "Starting dev server" step in boot stepper
  - SSE-based logs (vs REST polling for droplets)
  - xterm.js WebSocket terminal tab (new, droplets don't have this)
  - Graceful error handling for undeployed Phase 1 endpoints
  - Auto-request on mount, 30s heartbeat, stop/start/retry flows

### Verification
- `npx convex dev --once` — codegen succeeds
- `npx tsc --noEmit` — no new TypeScript errors
- Browser testing: Component renders correctly with all three tabs, error state displays properly (expected since Phase 1 host API extensions aren't deployed), logs tab shows "Connecting..." fallback, terminal tab shows "No terminal connection available"

---

## Review (a3a0aa83)

Reviewed all created/modified files. **No issues found.** Summary:

- **TypeScript**: `npx tsc --noEmit` passes (only pre-existing errors in pull-requests pages, unrelated)
- **Convex codegen**: `npx convex dev --once` succeeds
- **Schema alignment**: All indexes (`by_sessionId`, `by_repoId_branch`, `by_vmName`, `by_status`, `by_status_and_statusChangedAt`) and fields (`statusHistory`, `logsUrl`, `terminalUrl`, `previewUrl`, `apiSecret`, `errorMessage`, `vmName`, `retryCount`) match between schema.ts and code
- **`"use client"` directive**: Present on FirecrackerPreview.tsx
- **Import paths**: Consistent with existing `../../../convex/` pattern used by DropletPreview, FlyioSpritePreview, etc.
- **Props**: `FirecrackerPreview` accepts `{ repoId, sessionId, branch }` matching PreviewPanel call site
- **Mutations**: `request({ sessionId, branch })`, `heartbeat({ vmId })`, `requestStop({ vmId, reason })` all match backend arg definitions
- **Dependencies**: `@xterm/xterm@^6.0.0` and `@xterm/addon-fit@^0.11.0` present in package.json; CSS file exists at expected path
- **xterm CSS import**: Uses `@ts-expect-error` for CSS module import — standard pattern for dynamic CSS imports in Next.js

No fixes applied.
