# Task: Add Live WebContainer Preview to PR Review Page

## Context

The PLAN.md (Phase 5) specifies: "PR preview in WebContainers (load PR branch for live preview)" and "PR diff viewer alongside live preview." Two prerequisite tasks are being completed:

1. **Branch loading** (processing) — Adds optional `branch` param to `fetchRepoForWebContainer` and `useWorkspaceContainer` so we can load any branch, not just the default.
2. **PR review page** (processing) — Builds the PR review page at `/pull-requests/[repoId]/[prNumber]` with diff viewer, merge controls, and review status.

This task wires them together: embed a live WebContainer preview of the PR's head branch into the PR review page, giving owners a side-by-side view of diffs + running application.

### What will exist after prerequisites complete:
- `convex/github.ts` — `fetchRepoForWebContainer({ repoId, branch })` accepts an optional branch parameter
- `src/lib/webcontainer/useWorkspaceContainer.ts` — `useWorkspaceContainer(repoId, { branch })` loads a specific branch
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — PR review page with diffs and merge controls, but NO live preview
- `src/components/preview/PreviewPanel.tsx` — Existing preview component used in the workspace

### What's missing:
- The PR review page has no live preview — it only shows diffs
- No integration of `useWorkspaceContainer` with the PR review page
- No split layout showing diffs on one side and live preview on the other
- The PR review page doesn't use the `headBranch` to boot a WebContainer

## Requirements

### 1. Add a tabbed/split layout to the PR review page

Update `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` to add a live preview alongside the diffs:

- Add a **tab bar** at the top with two tabs: "Diff" and "Preview"
  - **Diff tab** (default): Shows the existing diff viewer, merge controls, review status — everything currently on the page
  - **Preview tab**: Shows a live WebContainer preview of the PR's `headBranch`
- OR use a **split view** (side-by-side): diffs on the left, preview on the right — using the existing `SplitPane` component from `src/components/layout/SplitPane.tsx`
- **Recommendation**: Use tabs (not split) since diffs can be wide and benefit from full width. The preview is a separate concern (seeing the running app vs. reading code changes).

### 2. Create a `PRPreview` component within the page

A self-contained component that:
- Takes `repoId` and `headBranch` as props
- Calls `useWorkspaceContainer(repoId, { branch: headBranch })` to boot the WebContainer with the PR's branch
- Shows the `PreviewPanel` component (iframe with the running app)
- Shows loading state while the WebContainer boots (reuse the boot status from the hook)
- Shows error state if the WebContainer fails to boot

```tsx
function PRPreview({ repoId, headBranch }: { repoId: Id<"repos">; headBranch: string }) {
  const container = useWorkspaceContainer(repoId, { branch: headBranch });

  if (container.status === "booting") {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <div className="text-center">
          <div className="mb-2 animate-spin h-8 w-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto" />
          <p>Booting preview for branch <code className="text-blue-400">{headBranch}</code>...</p>
        </div>
      </div>
    );
  }

  if (container.status === "error") {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        <p>Failed to boot preview: {container.error}</p>
      </div>
    );
  }

  return (
    <PreviewPanel
      previewUrl={container.previewUrl}
      status={container.status}
      // ... other props as needed
    />
  );
}
```

### 3. Wire the tab state and render

```tsx
export default function PRReviewPage() {
  // ... existing state (pr details, loading, etc.) ...
  const [activeTab, setActiveTab] = useState<"diff" | "preview">("diff");

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 bg-zinc-900">
        <button
          onClick={() => setActiveTab("diff")}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === "diff"
              ? "border-b-2 border-blue-500 text-blue-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Diff ({pr?.changedFiles ?? 0} files)
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === "preview"
              ? "border-b-2 border-blue-500 text-blue-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Live Preview
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "diff" && (
          /* existing diff + merge controls content */
        )}
        {activeTab === "preview" && pr && (
          <PRPreview repoId={repoId} headBranch={pr.headBranch} />
        )}
      </div>
    </div>
  );
}
```

### 4. Lazy-load the preview

The WebContainer should only boot when the user clicks the "Preview" tab — not on page load. This saves resources for users who just want to review diffs. Use a `hasOpenedPreview` flag:

```tsx
const [hasOpenedPreview, setHasOpenedPreview] = useState(false);

// When clicking Preview tab:
const handlePreviewTab = () => {
  setActiveTab("preview");
  setHasOpenedPreview(true);
};

// Only render PRPreview if user has opened it at least once:
{activeTab === "preview" && hasOpenedPreview && pr && (
  <PRPreview repoId={repoId} headBranch={pr.headBranch} />
)}
```

### 5. Run codegen and verify

- Run `npm -s convex codegen` (in case any new convex dependencies were added)
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | **Modify** | Add tab bar (Diff / Preview), `PRPreview` component using `useWorkspaceContainer` with `headBranch`, lazy-loading on tab switch |

## Acceptance Criteria

1. The PR review page has a tab bar at the top with "Diff" and "Preview" tabs
2. The "Diff" tab (default) shows the existing diff viewer and merge controls — unchanged from the current implementation
3. Clicking "Preview" boots a WebContainer with the PR's `headBranch`
4. The preview shows a loading spinner while the WebContainer boots
5. Once booted, the preview shows the running application in an iframe (via `PreviewPanel`)
6. If the WebContainer fails to boot, an error message is shown
7. The WebContainer only boots when the user first clicks "Preview" (lazy loading)
8. Switching between tabs preserves state (the preview stays alive when switching back to Diff)
9. The page layout fills the available height properly (no scrolling issues with the tab content)
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- **Depends on two in-progress tasks**: This task should be picked up AFTER both "add branch loading for PR preview" and "build PR review page" are complete. Check that `useWorkspaceContainer` accepts a `{ branch }` option and that the PR review page exists at the expected path.
- The `useWorkspaceContainer` hook likely returns an object with `status`, `previewUrl`, `error`, and potentially other WebContainer state. Check the actual return type before integrating.
- The `PreviewPanel` component may need the WebContainer instance or just the preview URL — check its props interface.
- Lazy loading is important: WebContainers are expensive. Don't boot one just because the user navigated to a PR page to review diffs.
- The preview tab should be kept mounted (but hidden) once opened, so switching back and forth between tabs doesn't re-boot the WebContainer. Use CSS `hidden` class or conditional rendering with the `hasOpenedPreview` flag.
- The dashboard layout may not be full-height like the workspace layout. If the preview needs full height, ensure the page fills the viewport (e.g., `h-[calc(100vh-64px)]` or similar).
- WebContainer CORS headers are set in `next.config.ts` — they apply to all pages, so no extra config needed.

## Completion Summary

### What was built
Added a tabbed interface to the PR review page with "Diff" and "Live Preview" tabs. The Diff tab shows the existing diff viewer, merge controls, and review status. The Live Preview tab embeds the existing `PreviewPanel` component, booting a WebContainer with the PR's head branch for a live running preview of the PR changes.

### Key implementation decisions
- **Used the existing `PreviewPanel` component** directly rather than creating a separate `PRPreview` wrapper. The `PreviewPanel` already accepts `repoId`, `sessionId` (null for PR preview), and `branch` props, and handles all loading/error/running states including the sub-tabs (Preview/Code/Terminal).
- **Tab-based layout (not split)** as recommended in the task spec — diffs benefit from full width.
- **Lazy loading**: The WebContainer only boots when the user clicks "Live Preview" for the first time (`hasOpenedPreview` flag).
- **State preservation**: Once opened, the preview stays mounted (hidden via CSS `hidden` class) when switching back to Diff, preventing WebContainer re-boots.
- **Full-height layout**: Changed the page container to `h-[calc(100vh-64px)]` to properly fill the viewport for the preview iframe.

### Changes made
- **`src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx`**:
  - Added `PreviewPanel` import
  - Added `activeTab` and `hasOpenedPreview` state variables
  - Restructured the page layout with a tab bar at the top (back arrow, "Diff (N files)", "Live Preview", repo/PR info)
  - Wrapped existing diff content in a tab panel that hides/shows based on active tab
  - Added a second tab panel that renders `PreviewPanel` with `branch={pr.headBranch}` and `sessionId={null}`
  - Preview panel only renders after user first clicks the "Live Preview" tab (lazy loading)

### Files changed
| File | Action |
|------|--------|
| `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` | Modified |

### Verification
- `npx tsc -p tsconfig.json --noEmit` — passed, no TypeScript errors
- Browser tested:
  - PR review page loads with "Diff" tab active showing all existing content (header, description, file diffs, merge controls)
  - Clicking "Live Preview" tab boots WebContainer with PR's head branch, showing loading states
  - Switching back to "Diff" tab preserves preview state (hidden but still running)
  - Tab styling shows active state correctly (blue underline)

## Review (d4717530)

### Files Reviewed
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — Tab bar, lazy preview loading, PreviewPanel integration

### No Issues Found
- `"use client"` directive present
- `PreviewPanel` import resolves correctly
- Props match the `PreviewPanelProps` interface: `repoId: Id<"repos">`, `sessionId: Id<"sessions"> | null` (passed as `null`), `branch?: string` (passed as `pr.headBranch`)
- Lazy loading via `hasOpenedPreview` works correctly — WebContainer only boots on first "Live Preview" click
- State preservation via CSS `hidden` class prevents WebContainer re-boots when switching tabs
- `h-[calc(100vh-64px)]` properly fills viewport for the preview iframe
- Backend actions `getPullRequestDetail` and `mergePullRequest` exist in `convex/github.ts`
- `tsc --noEmit` passes cleanly
