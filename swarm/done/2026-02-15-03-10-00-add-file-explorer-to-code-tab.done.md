# Task: Add File Explorer to Workspace Code Tab

## Context

The workspace's "Code" tab currently shows a single flat string from `sessions.getPreviewCode` — which is barely useful. Users can't browse the project's file structure, see what files exist, or inspect individual file contents. This is the most impactful remaining feature gap in the workspace experience.

The WebContainer already has all the repo files loaded into its filesystem. The `@webcontainer/api` provides `container.fs.readdir()` and `container.fs.readFile()` methods that can read back the file tree and individual files. We just need to build the UI.

### What exists now:
- `src/components/preview/PreviewPanel.tsx` — Has a "Code" tab that renders `previewCode ?? "No code preview available"` as a flat `<pre>` block
- `src/lib/webcontainer/files.ts` — Has `readFile(container, path)` utility
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Hook that boots and manages the WebContainer lifecycle; currently does NOT expose the container instance
- `src/lib/webcontainer/index.ts` — Has `getWebContainer()` singleton

### What's missing:
- No way to list files from the WebContainer
- No file tree UI component
- No file content viewer in the Code tab
- The WebContainer instance is not accessible from PreviewPanel for reading files

## Requirements

### 1. Add `readDirectory` utility to `src/lib/webcontainer/files.ts`

Add a recursive directory reading function:

```typescript
export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export async function readDirectory(
  container: WebContainer,
  dirPath: string = ".",
  skipDirs: string[] = ["node_modules", ".git", ".next", "dist", ".convex"],
): Promise<FileTreeNode[]> {
  const entries = await container.fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const fullPath = dirPath === "." ? entry.name : `${dirPath}/${entry.name}`;

    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      const children = await readDirectory(container, fullPath, skipDirs);
      nodes.push({ name: entry.name, path: fullPath, type: "directory", children });
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }

  // Sort: directories first, then alphabetical
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
```

Key details:
- Skip `node_modules`, `.git`, `.next`, `dist`, `.convex` directories (they're huge and irrelevant)
- Sort directories before files, then alphabetically
- Return a recursive tree structure

### 2. Expose `getWebContainer` access from `useWorkspaceContainer`

The `useWorkspaceContainer` hook boots the container but doesn't expose it. Add a `containerReady` boolean to the returned state that indicates the container singleton is available, so components can call `getWebContainer()` directly when they need to read files.

Actually, the simplest approach: `getWebContainer()` from `src/lib/webcontainer/index.ts` returns the singleton. After the container boots (phase is "mounting" or later), any component can call `getWebContainer()` to get the same instance. So no hook changes are needed — the PreviewPanel just needs to call `getWebContainer()` when the Code tab is selected and phase is past "booting".

### 3. Create `src/components/preview/FileExplorer.tsx`

A file tree + file viewer component that replaces the current Code tab content.

**Layout:**
```
┌──────────────────────────────────────────┐
│ File Tree (left, ~200px)  │  File Viewer │
│                           │              │
│ ▶ convex/                 │  // content  │
│   schema.ts               │  of selected │
│   auth.ts                 │  file        │
│ ▶ src/                    │              │
│   ▶ app/                  │              │
│     page.tsx              │              │
│   ▶ components/           │              │
│ package.json              │              │
│ tsconfig.json             │              │
└──────────────────────────────────────────┘
```

**File Tree (left panel):**
- Collapsible directories (click to expand/collapse)
- Directory icon (▶/▼) + folder/file name
- Clicking a file loads its content into the viewer
- Selected file has highlighted background
- Monospace font, small text (text-xs)

**File Viewer (right panel):**
- Shows file content with line numbers
- Monospace font, syntax coloring not required (just plain text is fine)
- Shows file path in a header bar above the content
- Loading state while file content is being read

**State management:**
- `selectedFile: string | null` — the path of the currently selected file
- `fileContent: string | null` — the content of the selected file
- `fileTree: FileTreeNode[] | null` — the tree structure (loaded once when Code tab opens)
- `loading: boolean` — true while reading directory or file content
- `expandedDirs: Set<string>` — which directories are expanded

**Behavior:**
- When the Code tab is first opened and WebContainer is ready, call `readDirectory()` to get the file tree
- Clicking a file calls `readFile()` to load content
- Cache file contents in a `Map<string, string>` so re-clicking a file doesn't re-read

### 4. Update `src/components/preview/PreviewPanel.tsx`

Replace the current Code tab content:

```tsx
// Old:
view === "code" ? (
  <div className="flex-1 overflow-auto bg-zinc-50 p-4 dark:bg-zinc-900">
    <pre className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
      <code>{previewCode ?? "No code preview available"}</code>
    </pre>
  </div>
)

// New:
view === "code" ? (
  <FileExplorer containerReady={phase !== "idle" && phase !== "booting"} />
)
```

Pass a `containerReady` boolean so FileExplorer knows when it's safe to call `getWebContainer()`.

### 5. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/webcontainer/files.ts` | **Modify** | Add `FileTreeNode` type and `readDirectory()` function |
| `src/components/preview/FileExplorer.tsx` | **Create** | File tree + file viewer component |
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Replace Code tab content with `<FileExplorer>` |

## Acceptance Criteria

1. Clicking the "Code" tab in the workspace shows a split view with file tree on the left and file viewer on the right
2. The file tree shows the project's directory structure (excluding node_modules, .git, etc.)
3. Directories can be expanded/collapsed by clicking
4. Clicking a file loads and displays its content with line numbers
5. File content is cached so re-selecting a file is instant
6. Selected file is visually highlighted in the tree
7. A loading indicator shows while the file tree or file content is being read
8. The file tree shows before the WebContainer dev server finishes (it only needs the filesystem, not the running server) — so it should work as soon as phase is past "mounting"
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `getWebContainer()` from `@/lib/webcontainer/index` to access the container singleton — no need to thread the instance through props
- The `readdir` API with `{ withFileTypes: true }` returns `DirEnt` objects with `isDirectory()` and `isFile()` methods
- Don't try to read binary files (images, etc.) — check file extension and show "Binary file" placeholder for non-text extensions
- Keep the file viewer simple — no syntax highlighting library. Just a monospace `<pre>` with line numbers. Syntax highlighting can be a future enhancement.
- The file tree might take 1-2 seconds to build for larger repos — show a spinner while loading
- Use `overflow-auto` on both panels so they scroll independently
- Dark theme: zinc-900 background for tree, zinc-950 for viewer area

## Completion Summary

### Agent: 40c20197

### Files Modified:
- `src/lib/webcontainer/files.ts` — Added `FileTreeNode` interface and `readDirectory()` recursive utility function that reads the WebContainer filesystem, skips irrelevant dirs (node_modules, .git, etc.), and returns a sorted tree structure
- `src/components/preview/PreviewPanel.tsx` — Replaced flat `<pre>` code view with `<FileExplorer>` component, removed unused `previewCode` query and related imports

### Files Created:
- `src/components/preview/FileExplorer.tsx` — Full file explorer component with:
  - Split layout: file tree (left, 224px) + file viewer (right)
  - Collapsible directory tree with expand/collapse indicators (▶/▼)
  - File selection with blue highlight
  - File content viewer with line numbers
  - File content caching via `Map<string, string>` ref
  - Binary file detection (shows "[Binary file]" placeholder)
  - Loading spinners for both tree loading and file loading states
  - "Waiting for container..." state when WebContainer isn't ready yet
  - Dark theme support with zinc color palette

### Verification:
- `npx tsc -p tsconfig.json --noEmit` passes with zero errors
- `npm run build` succeeds
- Browser tested via playwright-cli — app renders correctly (workspace/Code tab requires auth + active WebContainer to fully exercise)

## Review (9cf894b6)

**Reviewed all 3 files (1 created, 2 modified). No issues found.**

Checks performed:
- `src/lib/webcontainer/files.ts` — `FileTreeNode` interface properly typed. `readDirectory()` correctly uses recursive traversal, skips irrelevant directories (`node_modules`, `.git`, etc.), sorts directories-first then alphabetical. No issues.
- `src/components/preview/FileExplorer.tsx` — `"use client"` directive present (required — uses hooks). All imports resolve correctly (`@/lib/webcontainer/index`, `@/lib/webcontainer/files`). `treeLoadedRef` properly prevents double-loading in StrictMode. Effect cleanup sets `cancelled` flag to prevent state updates after unmount. Binary file detection handles edge cases correctly (files without extensions return `false` as expected). File content caching via `Map` ref works correctly. `TreeNode` recursive component properly handles expand/collapse state.
- `src/components/preview/PreviewPanel.tsx` — `"use client"` directive present. `FileExplorer` imported and passed `containerReady={phase !== "idle" && phase !== "booting"}` — correctly allows file tree loading as soon as files are mounted (before dev server finishes). Removed old flat `<pre>` code view. Status bar ternary correctly mixes string and JSX returns (both valid ReactNode children).
- `npm -s tsc -p tsconfig.json --noEmit` — passes with zero errors
- `npx convex dev --once` — passes
- No fixes needed — all code is clean
