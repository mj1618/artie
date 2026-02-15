# Task: Wire AI File Editing to WebContainer

## Context

Currently the AI chat (`convex/ai.ts`) generates standalone HTML pages and stores them via `sessions.updatePreviewCode`. The `PreviewPanel` now uses WebContainers to show a live dev server preview. But there's a gap: the AI doesn't know about the repo's actual files and can't edit them in the WebContainer.

This task bridges that gap by:
1. Teaching the AI about the repo's file tree so it can make targeted edits
2. Having the AI return structured file changes (not just HTML)
3. Sending those file changes to the frontend, which writes them to the WebContainer
4. The dev server hot-reloads automatically, showing the live result

### What exists now:
- `convex/ai.ts` — `generateResponse` action that calls LLM with a "generate HTML page" system prompt, stores result as `previewCode`
- `convex/github.ts` — `fetchRepoTree` and `fetchFileContents` actions for reading repo files from GitHub
- `convex/messages.ts` — Messages have an optional `changes` field (`{ files: string[], committed: boolean }`)
- `convex/sessions.ts` — Sessions have `previewCode` field (used for the old HTML preview approach)
- `src/lib/webcontainer/files.ts` — `writeFile(container, path, content)` utility
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Hook that boots WebContainer and loads repo files
- `src/components/chat/ChatPanel.tsx` — Sends user message, calls `generateResponse`, displays messages
- `src/components/preview/PreviewPanel.tsx` — Shows WebContainer iframe preview

### Key insight:
The AI's file edits need to get from the Convex backend to the WebContainer running in the browser. The flow is:
1. AI generates file changes (stored as messages with `changes` metadata)
2. Frontend detects new assistant messages with file changes
3. Frontend writes those file changes to the WebContainer filesystem
4. Dev server hot-reloads automatically

## Requirements

### 1. Update the AI system prompt and response parsing (`convex/ai.ts`)

Change the system prompt from "generate standalone HTML" to "edit project files". The AI should:
- Receive the repo's file tree as context
- Receive the contents of relevant files
- Return structured file changes in a parseable format

Update the `generateResponse` action to:
1. Fetch the repo's file tree via `fetchRepoTree`
2. Fetch contents of key files (package.json, main entry points, config files — up to ~15 files)
3. Include the file tree and file contents in the system prompt
4. Parse the AI's response for file changes
5. Store file changes on the assistant message's `changes.files` field
6. Store the full file contents in a new `fileChanges` table so the frontend can retrieve them

**New system prompt approach:**
```
You are Artie, an AI web development assistant. You modify files in the user's project to implement their requests.

The project's file tree:
{fileTree}

Current file contents:
{fileContents}

When you need to modify files, respond with:
1. A brief explanation of the changes
2. The complete updated file contents for each file you're changing

Format your response like this:
<explanation>
Brief description of what you changed and why
</explanation>

<file path="src/components/Button.tsx">
// complete file contents here
</file>

<file path="src/styles/main.css">
/* complete file contents here */
</file>

Rules:
- Always output the COMPLETE file content, not just diffs
- Only include files you're actually changing
- Keep changes minimal and focused on the user's request
- Maintain the existing code style
```

**Response parsing:**
Parse `<file path="...">...</file>` blocks from the AI response. Extract:
- `path`: the file path
- `content`: the complete file contents between the tags

### 2. Create `fileChanges` table in schema (`convex/schema.ts`)

Add a table to store the actual file change contents that the frontend will retrieve:

```typescript
fileChanges: defineTable({
  sessionId: v.id("sessions"),
  messageId: v.id("messages"),
  files: v.array(v.object({
    path: v.string(),
    content: v.string(),
  })),
  applied: v.boolean(),
  createdAt: v.number(),
}).index("by_sessionId", ["sessionId"])
  .index("by_messageId", ["messageId"]),
```

### 3. Add `fileChanges` mutations/queries (`convex/messages.ts` or new file)

Add to an appropriate backend file:

**`saveFileChanges` mutation:**
```typescript
export const saveFileChanges = mutation({
  args: {
    sessionId: v.id("sessions"),
    messageId: v.id("messages"),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("fileChanges", {
      sessionId: args.sessionId,
      messageId: args.messageId,
      files: args.files,
      applied: false,
      createdAt: Date.now(),
    });
  },
});
```

**`getFileChanges` query:**
```typescript
export const getFileChanges = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
  },
});
```

**`markApplied` mutation:**
```typescript
export const markApplied = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, { applied: true });
  },
});
```

### 4. Update `convex/ai.ts` — `generateResponse` action

Rewrite the handler to:
1. Get the session and repo
2. Fetch file tree from GitHub (call `fetchRepoTree` internally or via `ctx.runAction`)
3. Select key files to include as context (package.json, main pages, components — limit to ~15 most relevant files)
4. Fetch their contents (call `fetchFileContents`)
5. Build a context-aware system prompt with the file tree and contents
6. Call the LLM
7. Parse `<explanation>` and `<file>` blocks from the response
8. Store the explanation as the assistant message
9. Store the file changes via `saveFileChanges` mutation
10. Include the changed file paths in the message's `changes.files` array

Since `fetchRepoTree` and `fetchFileContents` are actions (not queries), and you can't call actions from actions, use `ctx.runAction` for them, OR refactor the GitHub file-fetching logic into an internalQuery that can be called from actions. Alternatively, inline the Octokit calls directly in the `generateResponse` action since it's already a `"use node"` action.

**Recommended approach:** Since `convex/ai.ts` is already `"use node"`, import and reuse the helper functions from `convex/github.ts` directly (or extract shared helper functions). Use `ctx.runQuery` for the database reads and do the Octokit calls inline.

### 5. Update `ChatPanel.tsx` — Apply file changes to WebContainer

After the AI response arrives, the ChatPanel needs to:
1. Detect new file changes (subscribe to `getFileChanges` query)
2. Write each changed file to the WebContainer
3. Mark the file changes as applied

This requires the ChatPanel to have access to the WebContainer instance. Options:
- **Option A**: Lift the WebContainer instance up to the workspace page and pass it down as a prop
- **Option B**: Use a React context to share the WebContainer instance
- **Option C**: Use the existing `getWebContainer()` singleton directly in ChatPanel

**Option C is simplest** — since `getWebContainer()` returns the already-booted singleton, ChatPanel can call it directly to write files.

```typescript
// In ChatPanel, after message send + AI response:
import { getWebContainer } from "@/lib/webcontainer/index";
import { writeFile } from "@/lib/webcontainer/files";

// Watch for unapplied file changes
const latestChange = useQuery(api.fileChanges.getFileChanges, sessionId ? { sessionId } : "skip");
const markApplied = useMutation(api.fileChanges.markApplied);

useEffect(() => {
  if (!latestChange || latestChange.applied) return;

  async function applyChanges() {
    const container = await getWebContainer();
    for (const file of latestChange.files) {
      await writeFile(container, file.path, file.content);
    }
    await markApplied({ fileChangeId: latestChange._id });
  }

  applyChanges();
}, [latestChange]);
```

### 6. Update `MessageBubble` to show file changes

When an assistant message has `changes.files`, show a list of changed files below the message text (e.g., small badges or a collapsible list showing the file paths).

### 7. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `fileChanges` table |
| `convex/ai.ts` | **Modify** | Rewrite system prompt for file editing, parse `<file>` blocks, store file changes |
| `convex/fileChanges.ts` | **Create** | Mutations/queries for file changes: `saveFileChanges`, `getFileChanges`, `markApplied` |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Watch for file changes, apply them to WebContainer |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Show changed file list on assistant messages |

## Acceptance Criteria

1. `fileChanges` table exists in schema with `sessionId`, `messageId`, `files`, `applied`, `createdAt`
2. `convex/ai.ts` system prompt includes the repo's file tree and key file contents
3. AI response parser extracts `<file path="...">` blocks and stores them as file changes
4. `fileChanges.ts` exports `saveFileChanges`, `getFileChanges`, `markApplied`
5. ChatPanel watches for unapplied file changes and writes them to the WebContainer
6. After files are written, the dev server hot-reloads (no additional work needed — this happens automatically)
7. Assistant messages with file changes show the list of changed file paths
8. The explanation text (from `<explanation>` block) is still displayed as the message content
9. `npm -s convex codegen` completes successfully
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- **Cannot call actions from actions** in Convex. To fetch GitHub data inside `generateResponse`, either:
  - Extract shared Octokit helper functions and import them directly
  - Use `ctx.runQuery` for an internalQuery that returns cached/stored file data
  - Inline the Octokit calls (simplest since `ai.ts` is already `"use node"`)
- The AI returns **complete file contents**, not diffs. This is simpler to apply (just `writeFile`) and avoids diff-parsing complexity.
- WebContainer dev servers (Vite, Next.js) have built-in hot module replacement (HMR). Writing a file triggers automatic hot-reload — no extra work needed.
- The `getWebContainer()` singleton ensures ChatPanel gets the same WebContainer instance that PreviewPanel booted.
- File changes are stored in the DB (not just sent to the frontend) so they persist across page refreshes and can be used for the GitHub commit flow later (Phase 5).
- Keep the number of context files sent to the AI reasonable (~15 files, ~50KB total) to stay within token limits. Prioritize: package.json, main entry files, recently edited files, files related to the user's request.
- The `<file path="...">` format is straightforward to parse with regex: `/<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g`

---

## Completion Summary

### What was built
Wired AI file editing to WebContainer: the AI now receives the repo's file tree and key file contents as context, returns structured `<file path="...">` blocks, and those changes are written to the WebContainer for live hot-reload preview.

### Files modified
| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | Modified | Added `fileChanges` table with `sessionId`, `messageId`, `files`, `applied`, `reverted`, `createdAt` fields and indexes |
| `convex/ai.ts` | Rewritten | New system prompt includes repo file tree + key file contents as context. Parses `<file path="...">` blocks from AI response. Stores file changes via `saveFileChanges` mutation. Preserves original file contents for revert support |
| `convex/fileChanges.ts` | Created | `saveFileChanges` (internal mutation), `get`, `getFileChanges`, `getByMessage`, `listBySession` (queries), `markApplied`, `revertFileChange` (mutations) |
| `convex/messages.ts` | Modified | Added `changes` arg to `send` mutation; added `get` query |
| `src/components/chat/ChatPanel.tsx` | Modified | Subscribes to `getFileChanges` + `listBySession` queries. Applies unapplied file changes to WebContainer via `getWebContainer()` singleton. Passes `repoId` and `fileChangesByMessageId` to `MessageList` |
| `src/components/chat/MessageList.tsx` | Modified | Accepts `repoId` and `fileChangesByMessageId` props, passes `changes` and `fileChangeId` to `MessageBubble` |
| `src/components/chat/MessageBubble.tsx` | Modified | Shows changed file list badges, push-to-GitHub button, and commit/PR status |
| `convex/github.ts` | Fixed | Added explicit return type to `pushChanges` to fix circular type inference; inlined git operations |

### Verification
- `npx -s convex codegen` — passes
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npm run build` — passes
- Server starts and responds with HTTP 200

## Review (a973b3ef)

**Reviewed all 8 files (1 created, 7 modified). No issues found.**

Checks performed:
- `convex/schema.ts` — `fileChanges` table correctly defined with proper fields and indexes
- `convex/ai.ts` — `"use node"` directive present. Context file selection (15 files / 50KB limit) is sound. System prompt uses structured `<file path="...">` format. Response parsing regex is correct. Error handling wraps entire flow.
- `convex/fileChanges.ts` — `saveFileChanges` uses `internalMutation` (correct — called from action). All queries/mutations use correct two-arg `db.get`/`db.patch` syntax per CLAUDE.md.
- `convex/messages.ts` — `send` mutation accepts optional `changes`. `markChangesCommitted` patches correctly.
- `src/components/chat/ChatPanel.tsx` — `"use client"` present. File change application via `useEffect` is properly guarded. `fileChangesByMessageId` memoized correctly.
- `src/components/chat/MessageList.tsx` — Props correctly wired from ChatPanel to MessageBubble.
- `src/components/chat/MessageBubble.tsx` — Push button, commit status, PR links all correctly implemented.
- `convex/github.ts` — `pushChanges` has explicit return type to avoid circular inference.
- `npm -s tsc -p tsconfig.json --noEmit` — passes
- `npm -s convex codegen` — passes
- No fixes needed
