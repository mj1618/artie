# Task: Add "Refresh from GitHub" Button to Workspace

## Context

Once the WebContainer boots and loads files from GitHub, the files are static. If someone pushes changes to the repo externally (or the user pushes from another tab), there's no way to pull those changes into the running WebContainer without a full restart (the "Retry" button tears everything down and reboots).

The PLAN.md (Phase 5) specifies: "Pull latest code from GitHub on session start." This task extends that concept by adding an explicit "Refresh from GitHub" button that incrementally updates files in the running WebContainer — without killing the dev server.

### What exists now:
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Has phase state machine (idle → booting → fetching → mounting → installing → starting → running). Has `retry()` which is destructive (full teardown + reboot).
- `convex/github.ts` — Has `fetchRepoForWebContainer` (returns full file tree) and `fetchFileContents` (returns contents for specific paths).
- `src/lib/webcontainer/files.ts` — Has `writeFile(container, path, content)` and `loadFiles(container, tree)` helpers.
- `src/components/preview/PreviewNavBar.tsx` — Has a refresh button that only reloads the iframe, not the underlying files.
- `src/components/preview/PreviewPanel.tsx` — Main preview component with tabs (Preview, Code, Terminal).

### What's missing:
- No way to pull updated files from GitHub into a running WebContainer
- No UI button to trigger a file refresh
- No diff/comparison to only update changed files (currently all-or-nothing)

## Requirements

### 1. Add `refreshFiles` function to `src/lib/webcontainer/useWorkspaceContainer.ts`

Add a new function that re-fetches files from GitHub and writes only the changed ones to the running WebContainer:

```typescript
const refreshFiles = async () => {
  if (!containerRef.current || phase !== "running") return;

  setRefreshing(true);
  try {
    // Fetch fresh file tree from GitHub
    const freshFiles = await fetchRepoFiles({ repoId });

    // Mount the full tree (WebContainer's mount will overwrite existing files)
    await loadFiles(containerRef.current, freshFiles);

    // The dev server's file watcher will auto-detect changes and hot-reload
    setRefreshing(false);
  } catch (err) {
    setRefreshing(false);
    // Show error but don't crash — container is still running
  }
};
```

Add a `refreshing` state boolean and expose it along with `refreshFiles` from the hook's return value.

### 2. Add a "Refresh from GitHub" button to `src/components/preview/PreviewNavBar.tsx`

Add a button (or enhance the existing refresh button) that:
- Only appears when the container is in `"running"` phase
- Shows a loading spinner while refreshing
- Calls `refreshFiles()` from the workspace container hook
- Has a tooltip saying "Pull latest files from GitHub"
- Uses a distinct icon (e.g., a download/cloud icon) so it's not confused with the iframe refresh button

### 3. Pass `refreshFiles` and `refreshing` from PreviewPanel down to PreviewNavBar

The `PreviewPanel` component already receives the workspace container state. Add `refreshFiles` and `refreshing` to its props and pass them down to `PreviewNavBar`.

### 4. Handle file change conflicts

When refreshing, if the user has pending (uncommitted) file changes in the current session:
- Show a warning toast: "Pulled latest from GitHub. Your uncommitted changes to X files were preserved."
- Skip overwriting files that have pending `fileChanges` in the current session (those are the user's work-in-progress edits that haven't been pushed yet)
- This requires checking `fileChanges` for the current session before mounting

### 5. Run codegen and verify

- Run `npx convex dev --once` if any Convex changes needed
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/webcontainer/useWorkspaceContainer.ts` | **Modify** | Add `refreshFiles` function and `refreshing` state |
| `src/components/preview/PreviewNavBar.tsx` | **Modify** | Add "Refresh from GitHub" button with loading state |
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Pass `refreshFiles` and `refreshing` props through to PreviewNavBar |

## Acceptance Criteria

1. A "Refresh from GitHub" button appears in the preview nav bar when the container is running
2. Clicking the button re-fetches files from GitHub and updates the WebContainer
3. The dev server hot-reloads automatically after files are updated (WebContainer's file watcher handles this)
4. The button shows a loading spinner while refreshing
5. Files with pending uncommitted `fileChanges` in the current session are NOT overwritten during refresh
6. A toast notification confirms the refresh completed (or shows an error)
7. The existing iframe refresh button still works independently
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- WebContainer's `mount()` method can be called on a running container — it will overwrite/add files without restarting processes
- The dev server (Vite, Next.js, etc.) has file watchers that will detect the updated files and trigger hot module replacement (HMR) automatically
- `fetchRepoForWebContainer` always fetches from `defaultBranch` — this gives us the latest state of the branch
- To check for pending file changes, query `fileChanges` by session ID where `committed` is false
- Keep it simple — don't try to do a git diff. Just re-mount the full tree (minus files with pending changes). The overhead is acceptable for a manual refresh action.
- Use the existing toast system (`useToast`) for success/error feedback

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `src/lib/webcontainer/files.ts` | Added `removePathsFromTree()` helper to filter specific file paths from a WebContainer `FileSystemTree`, preserving directory structure |
| `src/lib/webcontainer/useWorkspaceContainer.ts` | Added `sessionId` parameter, `refreshing` state, `containerRef`, `fileChanges` query via `useQuery`, and `refreshFiles()` function that re-fetches from GitHub while skipping files with pending session changes |
| `src/components/preview/PreviewNavBar.tsx` | Added `onRefreshFromGitHub` and `refreshing` optional props; renders a download-icon button with spinner when refreshing, only visible when handler is provided |
| `src/components/preview/PreviewPanel.tsx` | Passes `sessionId` to `useWorkspaceContainer`, wires `refreshFiles`/`refreshing` to `PreviewNavBar`, shows toast notifications for success/error/skipped-files |

### What Was Built

- **Refresh from GitHub button** in the preview nav bar (download icon, distinct from the iframe refresh button)
- **Incremental file refresh** — re-fetches the full file tree from GitHub and mounts it to the running WebContainer without restarting the dev server
- **File change conflict protection** — queries `fileChanges` for the current session and skips overwriting files that have pending (non-reverted) changes
- **Toast notifications** — success message on refresh, info message when files were skipped, error message on failure
- **Loading state** — button shows a spinning indicator while refresh is in progress, disabled to prevent double-clicks
- TypeScript passes cleanly (`tsc --noEmit`), build succeeds

---

## Reviewer Notes (ce447df8)

Reviewed all 4 modified files. No issues found:

- **TypeScript**: `tsc --noEmit` passes cleanly, `convex codegen` succeeds
- **`use client` directives**: Present where needed (`useWorkspaceContainer.ts`, `PreviewNavBar.tsx`, `PreviewPanel.tsx`)
- **Imports**: All imports resolve correctly — `useToast`, `api.github.fetchRepoForWebContainer`, `api.fileChanges.listBySession`, `removePathsFromTree`, `loadFiles` all verified
- **Schema alignment**: `fileChanges` table has `reverted: v.optional(v.boolean())` and `files` array with `path` field — code accesses these correctly
- **Props threading**: `refreshFiles`/`refreshing` correctly passed from `useWorkspaceContainer` → `PreviewPanel` → `PreviewNavBar`
- **`removePathsFromTree` logic**: Recursive path stripping and directory filtering logic is correct
- **Edge cases**: `sessionId` can be null (hook uses `"skip"` for `useQuery`), `fileChanges` can be undefined (guarded with `if (fileChanges)` check)

No fixes needed.

## Reviewer Notes (5b55d3f0)

Second review pass — confirmed all findings from prior reviewer. No additional issues found. TypeScript check passes, convex codegen succeeds, all imports and prop types are correct.

## Review (c8012fc0)

Reviewed all 4 files. `refreshFiles` correctly queries pending `fileChanges`, skips user edits via `removePathsFromTree`, returns structured result. `PreviewNavBar` conditionally renders GitHub refresh button with spinner. `PreviewPanel` wires toast notifications for all outcomes. TypeScript passes, codegen succeeds. No issues found, no fixes needed.
