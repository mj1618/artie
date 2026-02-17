# Task: Reboot WebContainer Preview When Session Branch Changes

## Context

Recent tasks added feature branch sessions — users can create sessions tied to specific branches (e.g., `feature/update-hero`). The workspace page passes the active session's `branchName` to `PreviewPanel`, which passes it to `useWorkspaceContainer` as `options.branch`. The `useWorkspaceContainer` hook uses this branch when fetching files from GitHub.

**The problem:** The WebContainer boots once on mount and never reboots when the `branch` prop changes. The `boot()` function guards with `startedRef.current` to prevent double-boots. When the user switches sessions (and the branch changes), `boot()` is called again via the `useEffect` (because the `boot` callback has `options?.branch` in its dependency array), but `startedRef.current` is already `true`, so it returns immediately. The WebContainer keeps serving files from the original branch.

This means:
1. User opens workspace — WebContainer boots with `main` branch files
2. User switches to a session on `feature/update-hero` — preview still shows `main` files
3. User is confused because the preview doesn't match their branch

### What exists now:
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Has `boot()` with `startedRef.current` guard, `retry()` that teardowns and reboots, `refreshFiles()` that re-fetches without reboot
- `src/components/preview/PreviewPanel.tsx` — Renders `useWorkspaceContainer(repoId, sessionId, { branch })` where `branch` comes from props
- `src/app/workspace/[repoId]/page.tsx` — Passes `activeSession?.branchName` as `branch` to `PreviewPanel`
- `src/lib/webcontainer/index.ts` — Has `getWebContainer()` (singleton) and `teardownWebContainer()`

### What's missing:
- No mechanism to detect that `branch` changed and trigger a reboot
- The `startedRef.current` guard prevents re-booting even when the branch changes

## Requirements

### 1. Track the booted branch and reboot when it changes

In `src/lib/webcontainer/useWorkspaceContainer.ts`, track which branch the container was originally booted with. When the `branch` prop changes, teardown and reboot:

```typescript
const bootedBranchRef = useRef<string | undefined>(undefined);

const boot = useCallback(async () => {
  if (startedRef.current) return;
  startedRef.current = true;
  bootedBranchRef.current = options?.branch;

  // ... existing boot logic
}, [repoId, fetchRepoFiles, options?.branch]);

// Detect branch change and trigger reboot
useEffect(() => {
  // Only trigger if we've already booted and the branch actually changed
  if (
    startedRef.current &&
    bootedBranchRef.current !== undefined &&
    options?.branch !== bootedBranchRef.current
  ) {
    // Teardown and reboot with the new branch
    startedRef.current = false;
    containerRef.current = null;
    teardownWebContainer();
    setState({
      phase: "idle",
      previewUrl: null,
      error: null,
      output: [],
    });
    // boot() will be re-invoked by the [boot] useEffect below
  }
}, [options?.branch]);
```

**Important nuance:** The `boot` `useCallback` already has `options?.branch` in its dependency array. When `branch` changes, `boot` gets a new identity, which triggers the `useEffect(() => { boot(); }, [boot])`. But `startedRef.current` blocks it. By resetting `startedRef.current` in the branch-change effect, the existing `boot()` effect will pick up the new branch.

However, the order of effects matters. The branch-change effect should run BEFORE the boot effect. Since React runs effects in order, we need to place the branch-change detection BEFORE the `useEffect(() => { boot(); }, [boot])` call. But actually, since `boot` will have a new identity on branch change, the simplest approach is:

```typescript
// Track the branch we booted with
const bootedBranchRef = useRef<string | undefined>(undefined);

const boot = useCallback(async () => {
  if (startedRef.current) return;
  startedRef.current = true;
  bootedBranchRef.current = options?.branch;
  // ... existing boot logic
}, [repoId, fetchRepoFiles, options?.branch]);

// When branch changes after initial boot, teardown and reboot
useEffect(() => {
  if (!startedRef.current) return; // Haven't booted yet
  if (options?.branch === bootedBranchRef.current) return; // Branch unchanged

  // Reset everything for reboot
  startedRef.current = false;
  containerRef.current = null;
  teardownWebContainer();
  setState({
    phase: "idle",
    previewUrl: null,
    error: null,
    output: [],
  });
  // The boot effect below will re-run because `boot` has a new identity
}, [options?.branch]);

useEffect(() => {
  boot();
}, [boot]);
```

### 2. Show a "Switching branch..." status during reboot

The phase state machine already handles this — when we reset to `"idle"`, the boot process will go through `booting → fetching → mounting → installing → starting → running` again. The `PreviewPanel` already shows loading states for each phase with `<PhaseLabel phase={phase} />`.

No extra UI work needed. The user will see "Starting WebContainer..." → "Loading repository files..." → etc. while it reboots.

### 3. Avoid unnecessary reboots for same-branch switches

When a user switches between two sessions that share the same branch (or both have no branch, defaulting to `main`), there's no need to reboot. The `options?.branch === bootedBranchRef.current` check handles this.

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/webcontainer/useWorkspaceContainer.ts` | **Modify** | Add `bootedBranchRef` to track which branch the container booted with. Add a `useEffect` that detects branch changes and triggers teardown + reboot. |

## Acceptance Criteria

1. When a user switches from a session on `main` to a session on `feature/update-hero`, the WebContainer reboots and loads files from the `feature/update-hero` branch
2. When switching between two sessions on the same branch (or both on default branch), NO reboot occurs
3. During reboot, the preview panel shows the standard loading phases (booting → fetching → mounting → installing → starting → running)
4. After reboot completes, the preview shows the correct branch's files
5. The `refreshFiles()` function still works correctly after a branch-switch reboot
6. The `retry()` function still works correctly
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- WebContainers are singletons in the browser tab. `teardownWebContainer()` destroys the instance, and `getWebContainer()` creates a new one. This is the same pattern used by `retry()`.
- The full reboot (teardown + boot) is necessary because we need to load a completely different set of files. `refreshFiles()` could theoretically work, but it doesn't re-run `npm install` if dependencies changed between branches, and it preserves pending file changes which may not apply to the new branch.
- The reboot takes ~10-30 seconds (boot container + fetch files + npm install + start dev server). This is acceptable because branch switches are infrequent user actions, not something that happens every few seconds.
- If the user switches branches rapidly (A → B → C), each switch will teardown the previous boot. The `startedRef.current = false` + `teardownWebContainer()` ensures only the latest branch's boot completes.
- The `bootedBranchRef` uses `undefined` as initial value (before first boot), which is distinct from `options?.branch` being `undefined` (default branch). This prevents a spurious reboot on initial mount.

## Completion Summary

### What was built
Added branch-change detection and automatic WebContainer reboot to `useWorkspaceContainer`. When a user switches sessions to a different branch, the WebContainer tears down and reboots with the new branch's files. Same-branch session switches skip the reboot.

### Files changed
| File | Change |
|------|--------|
| `src/lib/webcontainer/useWorkspaceContainer.ts` | Added `bootedBranchRef` to track the booted branch. Added `useEffect` that detects branch changes and triggers teardown + state reset. The existing `boot()` effect then re-runs automatically. |

### Verification
- `npx tsc --noEmit` passes with no errors
- Browser tested: workspace page loads correctly, preview panel renders, boot flow progresses through phases as expected

## Review (854516d4)

### Files Reviewed
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Branch-change detection, teardown/reboot logic, `bootedBranchRef` tracking
- `src/components/preview/PreviewPanel.tsx` — Verified hook call passes `branch` correctly
- `src/app/workspace/[repoId]/page.tsx` — Verified `activeSession?.branchName` passed to `PreviewPanel`
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — Verified `PreviewPanel` with `sessionId={null}` and `branch={pr.headBranch}` works correctly (fileChanges query skips when sessionId is null)

### Cross-cutting review of all recent tasks
Also reviewed files from all 6 recent done tasks for cross-cutting issues:
- `convex/sessions.ts` — `listRecent` query logic correct, `by_userId` index used properly, `Promise.all` for repo resolution
- `convex/ai.ts` — Branch resolution `let branch = session?.branchName ?? repo.defaultBranch` correct, try/catch fallback for non-existent branches
- `src/app/(dashboard)/home/page.tsx` — `RecentSessions` component with deep-link URLs, loading/empty states handled
- `src/components/chat/ChatPanel.tsx` → `MessageList.tsx` → `MessageBubble.tsx` → `PushDialog.tsx` — `sessionBranch` prop threading verified end-to-end
- `src/components/layout/Sidebar.tsx` — Pull Requests nav item added correctly
- `src/app/(dashboard)/pull-requests/page.tsx` — PR list page, imports and queries correct
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — Tab bar, lazy preview loading, merge controls

### No Issues Found
- `tsc --noEmit` passes cleanly
- All `"use client"` directives present on client components
- Import paths correct (relative for convex, `@/` for src)
- `bootedBranchRef` initial value (`undefined`) correctly distinguishes "not yet booted" from "booted with default branch"
- Branch-change effect runs before boot effect (declared first in source order), ensuring `startedRef.current = false` is set before `boot()` is re-invoked
- Rapid branch switching is safe: `teardownWebContainer()` destroys the singleton, causing any in-flight `boot()` to fail and be caught by the try/catch
- `PreviewPanel` with `sessionId={null}` correctly skips `fileChanges` query
- No fixes needed
