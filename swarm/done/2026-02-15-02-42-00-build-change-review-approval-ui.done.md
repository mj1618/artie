# Task: Build Change Review & Approval UI

## Context

Two tasks are in flight:
1. **`wire-ai-file-editing-to-webcontainer`** (processing) — AI returns structured `<file>` blocks, stores them in the `fileChanges` table, and the ChatPanel auto-applies them to the WebContainer for instant preview.
2. **`build-github-commit-flow`** (pending) — Adds "Approve & Push" button to commit changes to GitHub.

There's a gap between these: the user has no way to **review what changed** before deciding to push. The PLAN.md explicitly calls for:
- "User can approve or reject changes"
- "Change approval workflow"
- A `ChangePreview.tsx` component in the component tree

This task builds a **change review panel** that lets the user see exactly which files were modified, view the changes (old vs new), and decide whether to accept or reject them — all before the "Push to GitHub" step.

### What will exist after the in-progress tasks:
- `convex/fileChanges.ts` — `saveFileChanges`, `getFileChanges`, `markApplied` mutations/queries
- `fileChanges` table with `sessionId`, `messageId`, `files: [{path, content}]`, `applied`, `createdAt`
- `MessageBubble.tsx` — Shows assistant messages with a list of changed file paths
- `ChatPanel.tsx` — Auto-applies file changes to WebContainer when they arrive

### What's missing:
- No way to see the **contents** of the changes (what was modified in each file)
- No **diff view** comparing old vs new content
- No **reject/revert** capability — once applied, the user can't undo
- No `ChangePreview.tsx` component (listed in PLAN.md component tree)

## Requirements

### 1. Create `src/components/chat/ChangePreview.tsx`

A collapsible panel that shows file changes for an assistant message. It appears below the message text when the message has `changes.files`.

**Props:**
```typescript
interface ChangePreviewProps {
  files: { path: string; content: string }[];
  sessionId: Id<"sessions">;
  messageId: Id<"messages">;
}
```

**UI:**
- Collapsible container, collapsed by default, with header showing "N files changed" and expand/collapse toggle
- When expanded, shows a list of changed files as tabs or an accordion
- Each file shows:
  - File path as header
  - The **new content** with basic syntax highlighting (use a `<pre><code>` block with monospace font; no need for a full diff library)
  - Line count indicator
- A "Revert Changes" button that:
  - Writes the **original** file contents back to the WebContainer (requires storing originals — see section 2)
  - Removes the file change record or marks it as reverted

### 2. Store original file contents for revert capability

Update the file change flow so that when the AI generates changes, the **original** content of each modified file is also saved. This enables the "Revert" feature.

**Modify `convex/schema.ts`** — Add `originalContent` to the files array in `fileChanges`:
```typescript
fileChanges: defineTable({
  sessionId: v.id("sessions"),
  messageId: v.id("messages"),
  files: v.array(v.object({
    path: v.string(),
    content: v.string(),
    originalContent: v.optional(v.string()),  // <-- add this
  })),
  applied: v.boolean(),
  reverted: v.optional(v.boolean()),  // <-- add this
  createdAt: v.number(),
}).index("by_sessionId", ["sessionId"])
  .index("by_messageId", ["messageId"]),
```

**Modify `convex/ai.ts`** — When saving file changes, also fetch and include the original file contents from GitHub (or from the WebContainer's current state). Since the AI action already fetches file contents as context, the originals should already be available. Store them alongside the new content.

### 3. Add `revertFileChange` mutation to `convex/fileChanges.ts`

```typescript
export const revertFileChange = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, { reverted: true, applied: false });
  },
});
```

The frontend will handle writing original content back to the WebContainer.

### 4. Update `MessageBubble.tsx` to include `ChangePreview`

When an assistant message has file changes, render the `ChangePreview` component below the message content. Fetch the file change data using the `getFileChanges` query (by messageId).

Add a query to `convex/fileChanges.ts` if needed:
```typescript
export const getByMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileChanges")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
  },
});
```

### 5. Update `ChatPanel.tsx` — Add revert handler

Add a handler that, when the user clicks "Revert Changes":
1. Gets the file change record (which now includes `originalContent`)
2. Writes the original content back to the WebContainer for each file
3. Calls the `revertFileChange` mutation

### 6. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/ChangePreview.tsx` | **Create** | Collapsible panel showing changed files with content preview and revert button |
| `convex/schema.ts` | **Modify** | Add `originalContent` to fileChanges files array, add `reverted` field |
| `convex/fileChanges.ts` | **Modify** | Add `revertFileChange` mutation and `getByMessage` query |
| `convex/ai.ts` | **Modify** | Include original file contents when saving file changes |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Render `ChangePreview` below assistant messages with file changes |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Add revert handler that writes originals back to WebContainer |

## Acceptance Criteria

1. `ChangePreview` component renders below assistant messages that have file changes
2. Collapsible UI shows the list of changed files with their new content
3. Each file entry shows the file path and content in a monospace code block
4. "Revert Changes" button writes original content back to the WebContainer
5. After revert, the dev server hot-reloads showing the reverted state
6. `fileChanges` records include `originalContent` for each changed file
7. Reverted file changes are marked with `reverted: true` in the database
8. The revert button is hidden for already-reverted or already-committed changes
9. `npm -s convex codegen` completes successfully
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- **No external diff library needed.** A simple side-by-side or new-content-only view is sufficient for v1. A real diff view (like `react-diff-viewer`) can be added later as polish.
- **Original content source:** The `generateResponse` action in `ai.ts` already fetches file contents as context for the AI. Those same contents are the "before" state. Save them alongside the `<file>` block results.
- **Revert is WebContainer-local only.** It writes the old content back to the WebContainer filesystem. It does NOT interact with GitHub. The `build-github-commit-flow` task handles GitHub operations.
- **Ordering:** File changes should display in the order they appear in the `files` array (which matches the order the AI returned them).
- **This task does NOT depend on `build-github-commit-flow`** — it adds review/revert capability independently. The commit flow's "Approve & Push" button can later check if a change has been reverted and disable itself accordingly.
- Keep the `ChangePreview` component lightweight — it's rendered inside chat messages which should scroll smoothly.

---

## Completion Summary

### Files Created
- **`src/components/chat/ChangePreview.tsx`** — Collapsible panel showing changed files with content preview, line counts, accordion-style file expansion, and a "Revert Changes" button that writes originals back to the WebContainer and marks the change as reverted in the DB.

### Files Modified
- **`convex/schema.ts`** — Added `originalContent: v.optional(v.string())` to the `files` array in `fileChanges` table, and added `reverted: v.optional(v.boolean())` field.
- **`convex/fileChanges.ts`** — Added `getByMessage` query (fetches file change by messageId using `by_messageId` index), `revertFileChange` mutation (sets `reverted: true, applied: false`), and updated `saveFileChanges` args to accept `originalContent`.
- **`convex/ai.ts`** — Lifted `repoFileContents` to outer scope so it's available after the `if (repo)` block. Updated step 7 to include `originalContent` from the fetched GitHub file contents when saving file changes.
- **`src/components/chat/MessageBubble.tsx`** — Added `useQuery` call for `api.fileChanges.getByMessage` to fetch full file change data per message. Renders `ChangePreview` component below the message content when file change data exists.
- **`src/components/chat/ChatPanel.tsx`** — Added `latestChange.reverted` check to the apply-changes effect to prevent re-applying reverted changes.

### What Was Built
- A collapsible **ChangePreview** component that appears below assistant messages with file changes
- Accordion-style file list showing file path, line count, and expandable code content in monospace `<pre><code>` blocks
- "Revert Changes" button that writes original file contents back to the WebContainer filesystem and marks the file change as reverted in the database
- Revert button is hidden for already-reverted or committed changes
- "Reverted" badge shows on reverted changes
- Original file contents are captured from the GitHub file fetch that already happens in the AI action

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (no errors)
- `npm run build` — succeeded
- Browser tested with playwright-cli — pages load correctly

## Reviewer Notes (agent 69b737cb, iteration 3)

Reviewed all 8 files from this task plus related dependencies (`convex/sessions.ts`, `convex/github.ts`, `convex/messages.ts`, `src/components/chat/MessageList.tsx`).

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)

### Files reviewed (no issues found)

| File | Status |
|------|--------|
| `src/components/chat/ChangePreview.tsx` | Clean — `"use client"` present, correct relative imports for convex, `@/` for src-internal, proper error handling in revert flow, conditional rendering for revert button |
| `convex/schema.ts` | Clean — `fileChanges` table has `originalContent` in files array and `reverted` field, both indexes present |
| `convex/fileChanges.ts` | Clean — `saveFileChanges` correctly uses `internalMutation`, `getByMessage` uses `by_messageId` index, `revertFileChange` sets both `reverted: true` and `applied: false` |
| `convex/ai.ts` | Clean — `repoFileContents` properly scoped, `originalContent` correctly sourced from fetched GitHub contents, `internal.fileChanges.saveFileChanges` call matches internalMutation interface |
| `src/components/chat/MessageBubble.tsx` | Clean — `useQuery` for `getByMessage` skips for user messages, `ChangePreview` receives correct props, `pushChanges` action args correct |
| `src/components/chat/ChatPanel.tsx` | Clean — reverted check prevents re-applying reverted changes, `fileChangesByMessageId` map correctly built |
| `convex/github.ts` | Clean — `pushChanges` has explicit return type, git operations correct |
| `convex/messages.ts` | Clean — `send` mutation `changes` arg correctly omits `commitSha`/`prUrl` (added later via `markChangesCommitted`) |

**No fixes needed.** Code is clean and correct.

## Review (Reviewer 75870a68, iteration 3)

### Fixes Applied
1. **Fixed "Approve & Push to GitHub" button showing on reverted changes in `MessageBubble.tsx`** — The push button at line 105 only checked `!changes.committed && fileChangeId` but did not check `fileChangeData?.reverted`. This meant after a user reverted changes, the push button would still be visible, allowing them to push reverted (stale) changes to GitHub. Fixed by adding `!fileChangeData?.reverted` to the condition.

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed

### Notes
- All other files from this task and prior tasks look correct
- Import paths are consistent (relative `../../../convex/` for convex imports from `src/`, `@/` for src-internal imports)
- Schema, mutations, queries, and component wiring are all properly aligned

## Review (Reviewer a5aa7da7, iteration 4)

### Fixes Applied
1. **Fixed `writeFile` in `src/lib/webcontainer/files.ts` to create parent directories** — When the AI creates a new file in a directory that doesn't yet exist in the WebContainer filesystem, `container.fs.writeFile` would throw. Added `container.fs.mkdir(dir, { recursive: true })` before writing to handle new files in new directories. This affects both the `ChatPanel` auto-apply flow and the `ChangePreview` revert flow.

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)

### Notes
- Reviewed all files from the 4 most recent tasks (change-review-approval-ui, github-commit-flow, wire-ai-file-editing-to-webcontainer, wire-webcontainer-live-preview)
- Previous reviewer fixes (reverted push button guard, idle phase loading state) are correctly in place
- Code quality is good across all reviewed files
