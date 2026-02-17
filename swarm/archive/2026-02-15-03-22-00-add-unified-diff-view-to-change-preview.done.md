# Task: Add Unified Diff View to ChangePreview Component

## Context

The `ChangePreview` component (rendered inside assistant chat messages when the AI makes file changes) currently only shows the **new file content** in a flat `<pre><code>` block when expanded. It stores `originalContent` for revert purposes, but never displays a diff between the original and modified content. This means users approving changes have to read the entire new file to understand what changed — which is impractical for larger files.

A simple unified diff view would let users quickly see exactly what lines were added, removed, or changed before committing to GitHub. This is the most impactful UX improvement remaining in the change-approval workflow.

### What exists now:
- `src/components/chat/ChangePreview.tsx` — Shows list of changed files, can expand to see full new content, has revert button. Receives `files` array with `{ path, content, originalContent? }`.
- `convex/fileChanges.ts` — Stores file changes with original content for revert support
- The `originalContent` field is already populated and passed through — we just need to compute and display a diff

### What's missing:
- No diff computation between original and new content
- No color-coded diff view (green for additions, red for deletions)
- Users can only see the raw new file content, not what changed

## Requirements

### 1. Install `diff` package

```bash
npm install diff
npm install -D @types/diff
```

The `diff` package is the standard JS library for computing text diffs. It provides `createTwoFilesPatch` and `structuredPatch` functions that produce unified diff output.

### 2. Create `src/components/chat/DiffView.tsx`

A client component that renders a unified diff between two strings:

```tsx
"use client";

import { structuredPatch } from "diff";

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  filePath: string;
}
```

Key implementation details:
- Use `structuredPatch(filePath, filePath, oldContent, newContent)` to compute the diff
- Render each hunk with a header line (e.g., `@@ -10,5 +10,7 @@`) in a muted color
- Color-code lines:
  - Lines starting with `+` → green background (`bg-green-950/30 text-green-300`)
  - Lines starting with `-` → red background (`bg-red-950/30 text-red-300`)
  - Context lines → default styling
- Wrap in a scrollable `<pre>` with line numbers
- If there are no differences, show "No changes" message
- If `oldContent` is empty/undefined, show the new content as all additions (new file)
- Keep it simple — no syntax highlighting, just diff coloring

### 3. Update `src/components/chat/ChangePreview.tsx`

When a file is expanded, show the diff view instead of (or alongside) the raw new content:
- If `originalContent` is available: render `<DiffView oldContent={originalContent} newContent={content} filePath={path} />`
- If `originalContent` is not available (new file): show the current raw content view (all green, indicating entirely new)
- Add a toggle button "Diff / Full" to switch between diff view and full file view
- Default to diff view when original content is available

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/DiffView.tsx` | **Create** | Unified diff renderer component |
| `src/components/chat/ChangePreview.tsx` | **Modify** | Use DiffView when original content is available, add Diff/Full toggle |

## Acceptance Criteria

1. When a file change has `originalContent`, expanding the file shows a unified diff view by default
2. Added lines are highlighted in green, removed lines in red, context lines are neutral
3. Hunk headers (`@@ ... @@`) are displayed in a muted style
4. A "Diff / Full" toggle lets users switch between diff view and full file content
5. New files (no `originalContent`) show the full content as before
6. Line numbers are displayed for orientation
7. The diff view scrolls horizontally for long lines and vertically for large diffs (max-height same as current: `max-h-64`)
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `diff` npm package is ~50KB and has zero dependencies — lightweight addition
- `structuredPatch` returns an array of hunks, each with an array of lines — this maps naturally to React rendering
- Don't over-engineer: no syntax highlighting, no side-by-side view, just a clean unified diff
- The component should handle edge cases: empty files, binary content (just show "Binary file"), very large diffs (the max-h-64 scroll container handles this)

---

## Completion Summary

### What was built
Added a unified diff view to the ChangePreview component so users can see exactly what lines were added/removed when reviewing AI file changes, instead of having to read the entire new file.

### Files changed
| File | Action | Description |
|------|--------|-------------|
| `package.json` / `package-lock.json` | Modified | Added `diff` and `@types/diff` dependencies |
| `src/components/chat/DiffView.tsx` | **Created** | New component that uses `structuredPatch` from the `diff` library to compute and render a color-coded unified diff between old and new file content. Green lines for additions, red for deletions, muted hunk headers, and line numbers. |
| `src/components/chat/ChangePreview.tsx` | **Modified** | Integrated DiffView — when a file has `originalContent`, the diff view is shown by default. Added a Diff/Full toggle bar so users can switch between the diff view and the full file content view. New files (without `originalContent`) still show raw content as before. |

### Verification
- `npx tsc -p tsconfig.json --noEmit` passes with no errors
- `npm run build` succeeds with no errors
- App loads successfully on localhost

## Review (16016127)

**Reviewed 2 files (1 created, 1 modified). Found and fixed 1 issue.**

Checks performed:
- `src/components/chat/DiffView.tsx` — `"use client"` directive present. `structuredPatch` import correct. Props interface properly typed.
  - **BUG FOUND & FIXED**: Line numbering logic was broken for multi-hunk diffs. The original code used a mutable `lineNumber` variable declared outside the `.map()` call, with a condition `hunkIndex === 0 && lineIndex === 0` to initialize it. For the second and subsequent hunks, it would just increment from the last hunk's final line number instead of resetting to `hunk.newStart`. Fixed by scoping `let newLineNum = hunk.newStart` inside each hunk's render function, and using `newLineNum++` for non-deletion lines. Deletion lines correctly show `&nbsp;` (no line number).
- `src/components/chat/ChangePreview.tsx` — `"use client"` directive present. `DiffView` imported from correct path. Diff/Full toggle uses `viewMode` state record keyed by file path (correct pattern for per-file view mode). Default view mode is "diff" when `originalContent` is available. Revert logic properly checks `!reverted && !committed`. `useToast` hook for success/error feedback. No issues found.
- `npx tsc -p tsconfig.json --noEmit` — passes after fix
- `npx -s convex codegen` — passes

## Review (a3b2bd4f)

**Confirmed prior review fix is correct. No additional issues found.**

Verified that the line numbering fix from review 16016127 is properly implemented — `let newLineNum = hunk.newStart` is correctly scoped inside each hunk's render, and increments only for non-deletion lines. DiffView and ChangePreview both verified clean. TypeScript and convex codegen pass.
