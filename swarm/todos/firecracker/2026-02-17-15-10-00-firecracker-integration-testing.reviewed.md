# Task: Firecracker Integration Testing & Bug Fixes

## What to Build

Run end-to-end integration testing of the Firecracker runtime path through the web application. The host API (Phase 1) is not yet deployed, so actual VM creation will fail — but we can verify:

1. The full UI flow works: selecting Firecracker runtime, opening a workspace, seeing the preview component
2. The build compiles and runs without errors
3. The Firecracker preview component renders correctly with proper loading/error states
4. The ChatPanel correctly routes to Firecracker actions when the runtime is "firecracker"
5. No TypeScript errors exist

Fix any bugs found during testing.

## Testing Steps

### 1. Build Verification

- Run `npx convex dev --once` — codegen must succeed
- Run `npx tsc --noEmit` — zero TypeScript errors
- Run `npm run dev` — app must start without crashes

### 2. Browser Testing (playwright-cli)

**Test A: Set a repo to Firecracker runtime**
1. Sign in with the test account (matthew.stephen.james@gmail.com / xt4yArXEXhDjng8R9T7QTpjL8j&@)
2. Navigate to a connected repo's settings page
3. Select "Firecracker VM (server)" as the runtime
4. Save settings
5. Verify the setting persists on page reload

**Test B: Open workspace with Firecracker runtime**
1. Navigate to the workspace for the repo with Firecracker runtime
2. Verify the FirecrackerPreview component renders (not WebContainer or other preview)
3. Verify the boot progress stepper is visible
4. Verify the VM request is created (status should move to "requested" → "creating")
5. Since the host API isn't deployed, expect it to eventually show an error state — verify the error is displayed cleanly with a friendly message (not a raw stack trace)

**Test C: Verify tab switching**
1. In the FirecrackerPreview, switch between Preview, Logs, and Terminal tabs
2. Verify each tab renders without crashing
3. Verify the Logs tab shows the statusHistory fallback when SSE is unavailable

### 3. Fix Any Issues Found

Common things to check:
- Missing null checks or conditional rendering
- Broken imports
- UI elements that don't render properly
- Error states that show technical details to users
- Race conditions in the VM request flow

## Files Likely Involved

- `src/components/preview/FirecrackerPreview.tsx` — main preview component
- `src/components/preview/PreviewPanel.tsx` — runtime routing
- `src/components/chat/ChatPanel.tsx` — chat integration
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — runtime settings
- `convex/firecrackerVms.ts` — backend queries/mutations
- `convex/firecrackerScheduler.ts` — scheduler functions
- `convex/firecrackerFiles.ts` — file operations

## How to Verify

1. `npx tsc --noEmit` — zero errors
2. `npm run dev` — app starts cleanly
3. Browser smoke test passes: can select Firecracker runtime, open workspace, see preview component, switch tabs
4. Error states are user-friendly (no raw errors or stack traces visible)

---

## Completion Summary

**Agent**: d30700aa
**Completed**: 2026-02-17

### Build Verification Results

- `npx convex dev --once` — codegen succeeded (7.74s)
- `npx tsc --noEmit` — zero TypeScript errors
- `npm run dev` — app builds and starts without crashes

### Browser Testing Results

**Test A: Set a repo to Firecracker runtime** — PASSED
- Signed in with test account
- Navigated to mj1618/artie-example-next settings page
- Selected "Firecracker VM (server)" as runtime
- Saved settings
- Verified setting persisted after page reload (Firecracker radio still checked)

**Test B: Open workspace with Firecracker runtime** — PASSED
- Navigated to workspace for repo with Firecracker runtime
- FirecrackerPreview component rendered correctly (not WebContainer or other preview)
- Boot progress stepper was visible with all 7 phases (Queued → Creating VM → Booting VM → Cloning repository → Installing dependencies → Starting dev server → Ready)
- VM request was created and progressed through states (requested → creating → booting)
- Error state displayed cleanly with friendly message after host API unreachable

**Test C: Verify tab switching** — PASSED
- Switched between Preview, Logs, and Terminal tabs — all rendered without crashing
- Preview tab: Shows VM state (stopped/error/booting)
- Logs tab: Shows log panel with auto-scroll, falls back to "Waiting for logs..." when no SSE
- Terminal tab: Shows dark terminal background with "No terminal connection available" when VM not ready

### Bug Found and Fixed

**Bug**: Raw HTML error messages from the Firecracker host API were displayed directly to users in the error state. When the host API returned a 404, the full HTML error page (`<!DOCTYPE html>...Cannot POST /api/vms/.../setup...`) was shown in the UI.

**Fix**: Added `getFriendlyErrorMessage()` function to `FirecrackerPreview.tsx` that:
- Strips HTML tags from error messages
- Maps known error patterns to user-friendly messages (connection refused, 404, timeout, auth errors, etc.)
- Falls back to a generic message for long/HTML-containing errors
- Raw error details remain available via the "Show details" toggle

### Files Changed

- `src/components/preview/FirecrackerPreview.tsx` — Added `getFriendlyErrorMessage()` function and updated error display to use it

---

## Review (Agent 9e41eeab)

**Reviewed**: 2026-02-17

### Review Checklist

- [x] TypeScript check (`npx tsc --noEmit`) — zero errors
- [x] `"use client"` directives present on all client components
- [x] Imports correct (relative paths consistent with codebase patterns)
- [x] Schema matches backend code (firecrackerVms table fields align)
- [x] HTTP route `/firecracker-status` properly registered and validates inputs
- [x] Cron jobs registered for all scheduler functions
- [x] State machine transitions validated in `updateStatus`
- [x] Frontend components handle loading/error/stopped states
- [x] `getFriendlyErrorMessage()` properly strips HTML and maps error patterns

### Bug Found and Fixed

**Bug**: In `convex/firecrackerVms.ts` `destroyVm` action, line 923 redundantly transitions the VM to `"destroying"` state. When called from the scheduler (`processStopping` or `processUnhealthy`), the VM is already in `"destroying"` state, causing an invalid `destroying -> destroying` transition that logs a spurious warning via `updateStatus`.

**Fix**: Added a guard `if (vm.status !== "destroying")` before the transition, so `destroyVm` skips the redundant status update when the scheduler has already moved the VM to `destroying`.

### Files Changed

- `convex/firecrackerVms.ts` — Added guard to skip redundant `destroying` transition in `destroyVm`
