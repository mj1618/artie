# Task: Make AI Context Include Prior Session Edits

## Context

The AI's `generateResponse` action in `convex/ai.ts` always fetches the **original** file contents from GitHub via Octokit. It never reads the `fileChanges` table, which stores all file edits the AI has made during the current session. This means the AI can't build on its own previous changes.

**Example of the bug:**
1. User: "Change the button color to red"
2. AI edits `src/components/Button.tsx`, changes color to red — stored in `fileChanges`
3. User: "Also make the button larger"
4. AI fetches the **original** `Button.tsx` from GitHub (still blue!) and makes it larger
5. Result: the button is larger but the red color change is lost

This is the #1 correctness bug in the AI editing workflow. Every multi-turn editing conversation is broken because the AI operates on stale file contents.

### What exists now:
- `convex/ai.ts` — `generateResponse` action fetches files from GitHub on every call, builds system prompt with those files. Never reads `fileChanges`.
- `convex/fileChanges.ts` — `listBySession` query returns all file changes for a session. Each entry has `files: [{path, content, originalContent?}]`, `applied: boolean`, `reverted: boolean | undefined`, `createdAt: number`.
- The `fileChanges` entries are ordered by `_creationTime` (implicit Convex ordering).
- A file may be edited multiple times across different messages — the most recent non-reverted edit is the "current" version.

### What's missing:
- The AI doesn't overlay prior session edits on top of the GitHub file contents
- No mechanism to build a "current working state" from the base GitHub files + accumulated edits

## Requirements

### 1. Add an internal query to get the current working files for a session (`convex/fileChanges.ts`)

Add a new query that computes the latest version of each file by applying all non-reverted edits in order:

```typescript
export const getCurrentFiles = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const allChanges = await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    // Build a map of path -> latest content, skipping reverted changes
    const currentFiles: Record<string, string> = {};
    for (const change of allChanges) {
      if (change.reverted) continue;
      for (const file of change.files) {
        currentFiles[file.path] = file.content;
      }
    }
    return currentFiles;
  },
});
```

This returns a `Record<string, string>` — file path to current content — representing all files the AI has edited in this session (latest version of each).

### 2. Update `convex/ai.ts` `generateResponse` to overlay session edits

After fetching the original file contents from GitHub (step 3 in the current flow), overlay the session's accumulated edits:

```typescript
// After building repoFileContents from GitHub...

// Overlay any prior edits from this session
const sessionEdits = await ctx.runQuery(
  internal.fileChanges.getCurrentFiles,
  { sessionId: args.sessionId },
);

// Merge: session edits override GitHub originals
for (const [path, content] of Object.entries(sessionEdits)) {
  repoFileContents[path] = content;
}

// Also ensure edited files appear in the context even if they weren't
// in the initial selectContextFiles list
const editedPaths = Object.keys(sessionEdits);
for (const path of editedPaths) {
  if (!(path in repoFileContents)) {
    repoFileContents[path] = sessionEdits[path];
  }
}
```

This means:
- Files the AI previously edited will show their **latest** version (not the GitHub original)
- Files the AI edited that weren't in the initial context selection will still appear in the context
- Files the AI hasn't touched remain at their GitHub original version

### 3. Update `selectContextFiles` to accept a list of "must-include" paths

Currently `selectContextFiles` picks the top 15 files by priority + size. But files the AI previously edited should **always** be included (they're the most relevant context). Update the function:

```typescript
function selectContextFiles(
  tree: { path: string; type: string; size: number }[],
  mustInclude?: string[],
): string[] {
  const must = new Set(mustInclude ?? []);
  const blobs = tree.filter((f) => f.type === "blob");

  // Always include must-include paths first
  const selected: string[] = [];
  let totalSize = 0;
  for (const path of must) {
    const blob = blobs.find((f) => f.path === path);
    if (blob) {
      selected.push(path);
      totalSize += blob.size;
    }
  }

  // Then fill remaining slots with priority-scored files
  const scored = blobs
    .filter((f) => !must.has(f.path))
    .map((f) => {
      const isPriority = PRIORITY_PATTERNS.some((p) => p.test(f.path));
      return { path: f.path, size: f.size, score: isPriority ? 0 : 1 };
    });

  scored.sort((a, b) => a.score - b.score || a.size - b.size);

  for (const f of scored) {
    if (selected.length >= MAX_CONTEXT_FILES) break;
    if (totalSize + f.size > MAX_CONTEXT_BYTES) continue;
    selected.push(f.path);
    totalSize += f.size;
  }
  return selected;
}
```

Then call it with the edited paths:
```typescript
const contextPaths = selectContextFiles(tree, Object.keys(sessionEdits));
```

### 4. Also store the `originalContent` correctly when the AI edits a file it already edited before

Currently in step 7 of `generateResponse`:
```typescript
originalContent: repoFileContents[f.path] ?? undefined,
```

With the overlay, `repoFileContents[f.path]` will be the **session-edited** version (not the GitHub original). That's actually correct for the revert UX — reverting should restore to the state *before this specific edit*, which is the current working version. But we should make sure the very first edit's `originalContent` still points to the GitHub original. With the overlay approach, this happens naturally:
- First edit: `repoFileContents` has GitHub original → `originalContent` = GitHub original ✓
- Second edit: `repoFileContents` has first-edit version → `originalContent` = first-edit version ✓

No change needed here — just verifying the logic is correct.

### 5. Run codegen and verify

- Run `npx convex dev --once` after adding the internal query
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/fileChanges.ts` | **Modify** | Add `getCurrentFiles` internal query that computes the latest working version of each file from accumulated session edits |
| `convex/ai.ts` | **Modify** | Import and call `getCurrentFiles` to overlay session edits onto GitHub file contents; pass edited paths to `selectContextFiles` as must-includes |

## Acceptance Criteria

1. When the AI generates a response, files it previously edited in the same session appear with their latest edited content (not the GitHub original)
2. Previously edited files are always included in the AI's context, even if they wouldn't have been selected by the priority algorithm
3. Files the AI hasn't touched still show their original GitHub content
4. Reverting a file change correctly stores the `originalContent` as the pre-edit version (not the original GitHub version from several edits ago)
5. The `getCurrentFiles` query skips reverted file changes
6. `npx convex dev --once` runs without errors
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `internalQuery` for `getCurrentFiles` since it's only called from the `generateResponse` action (server-side only)
- The overlay approach is simple and correct: start with GitHub originals, overwrite with session edits. Later edits naturally override earlier ones.
- Don't increase `MAX_CONTEXT_FILES` or `MAX_CONTEXT_BYTES` — instead, the must-include approach ensures edited files take priority slots. This may mean fewer auto-selected files, which is the right tradeoff (files the user is actively working on are more important than config files).
- The session edits query is a small read — it's just the fileChanges for one session. No performance concern.

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/fileChanges.ts` | Added `getCurrentFiles` internal query — queries all fileChanges for a session, iterates in ascending order, skips reverted changes, builds a `Record<string, string>` of path → latest content |
| `convex/ai.ts` | Updated `selectContextFiles` to accept optional `mustInclude` parameter that guarantees previously-edited files get priority context slots. Updated `generateResponse` to call `getCurrentFiles` before building context, pass edited paths to `selectContextFiles`, and overlay session edits onto GitHub file contents before building the system prompt |

### What Was Built

- **`getCurrentFiles` internal query**: Computes the current working state of all files edited in a session by scanning fileChanges in chronological order, skipping reverted entries, and keeping the latest content for each path.
- **Must-include context selection**: Previously-edited files are always included in the AI's context window, taking priority over auto-selected files. This ensures the AI always sees its own prior work.
- **Session edit overlay**: After fetching original files from GitHub, the `generateResponse` action overlays session edits so the AI sees the latest working version of each file rather than stale GitHub originals.
- **Correct `originalContent` behavior**: The overlay naturally ensures `originalContent` stores the pre-edit version (first edit gets GitHub original, subsequent edits get the prior session-edited version), making revert work correctly at every step.

### Verification

- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed, zero type errors
- Next.js build — succeeded, app renders correctly
- Browser test — login page loads and renders properly

## Review (e4a40e68)

**Reviewed `convex/fileChanges.ts` and `convex/ai.ts`. No issues found.**

Checks performed:
- `convex/fileChanges.ts` — `getCurrentFiles` internal query correctly uses `internalQuery`, queries by `by_sessionId` index in ascending order, skips reverted changes, builds `Record<string, string>` with latest content per path. Logic is correct.
- `convex/ai.ts` — `selectContextFiles` correctly accepts optional `mustInclude` parameter, adds must-include paths first (taking priority slots), then fills remaining with priority-scored files. `generateResponse` correctly calls `getCurrentFiles` before building context, passes `editedPaths` to `selectContextFiles`, and overlays `sessionEdits` onto `fileContents` after GitHub fetch. The overlay order is correct (session edits override GitHub originals). `originalContent` behavior is naturally correct with overlay approach.
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed

## Review (5e5b1cc8)

**Reviewed recent task files and all modified components. One fix applied, one stale codegen issue resolved.** (Review by 5e5b1cc8)

### Files reviewed:
- `convex/fileChanges.ts` — `getCurrentFiles` query is correct
- `convex/ai.ts` — session edit overlay and `selectContextFiles` must-include logic is correct
- `src/components/chat/DiffView.tsx` — Line numbering logic correct (newLineNum incremented for + and context lines, not - lines)
- `src/components/chat/ChangePreview.tsx` — DiffView integration with Diff/Full toggle works correctly
- `src/components/chat/MarkdownContent.tsx` — **Fixed** code block detection
- `src/components/chat/MessageBubble.tsx` — Clean, correct integration with MarkdownContent and ChangePreview
- `src/components/layout/SplitPane.tsx` — Mobile/desktop breakpoint logic correct
- `src/components/chat/ChatPanel.tsx` — Has deleteSession and renameSession handlers, passes them to SessionPicker correctly
- `src/components/chat/MessageList.tsx` — Correct prop passing
- `convex/schema.ts` — Has `name` field on sessions and `reverted` field on fileChanges

### Fix applied:
1. **`src/components/chat/MarkdownContent.tsx`** — The `code` component override only checked `className?.startsWith("language-")` to determine block vs inline code. Fenced code blocks without a language specifier (e.g., bare ``` blocks) have no `className`, so they were styled as inline code (light background) inside a dark `<pre>` wrapper — visual mismatch. Added a fallback check using `node?.position` to detect multi-line code elements as block code.

### Issue resolved:
- TypeScript check initially reported `SessionPicker` missing `onDeleteSession` and `onRenameSession` props — this was due to stale `api.d.ts` codegen. The handlers and mutations were already implemented in `ChatPanel.tsx` and `convex/sessions.ts`. Running `npx convex codegen` resolved the type error.

### Verification:
- `npx convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passes, zero errors

## Review (bdfd0d50)

**Re-reviewed `convex/fileChanges.ts` and `convex/ai.ts`. No new issues found.** Code is clean and correct. Both `npx -s tsc -p tsconfig.json --noEmit` and `npx -s convex codegen` pass. No fixes needed.

## Review (83ae8b15)

**Full review of `convex/ai.ts` and `convex/fileChanges.ts`. No issues found.** `getCurrentFiles` correctly queries by session index in ascending order, skips reverted changes, builds record. `selectContextFiles` must-include logic correct — edited files take priority slots. Session edit overlay in `generateResponse` correctly applied after GitHub fetch. Streaming integration with `streamText` and incremental DB updates correct. `tsc --noEmit` and `convex codegen` pass. No fixes needed.
