# Task: Add Streaming AI Responses via Convex Mutations

## Context

The AI chat currently uses `generateText()` from the Vercel AI SDK, which waits for the complete response before storing it in the database. The user sees only a typing indicator (animated dots) for the entire generation time — which can be 10-30 seconds for complex responses. This is the #1 UX gap in the chat experience. Every modern AI chat interface streams responses token-by-token.

### What exists now:
- `convex/ai.ts` — `generateResponse` action that calls `generateText()` (non-streaming), waits for the complete response, then stores it as a single message via `api.messages.send`
- `src/components/chat/ChatPanel.tsx` — Sets `sending=true`, calls `generateResponse`, waits for completion, then `sending=false`. During generation, `isTyping=true` is passed to `MessageList`
- `src/components/chat/MessageList.tsx` — Shows a `<TypingIndicator />` at the bottom when `isTyping` is true
- `src/components/chat/TypingIndicator.tsx` — Animated dots
- `src/components/chat/MessageBubble.tsx` — Renders messages with `MarkdownContent` for assistant messages
- `convex/messages.ts` — `send` mutation to insert messages, `list` query to fetch by session

### Key constraint:
Convex actions cannot stream HTTP responses directly to the client. The standard pattern for streaming in Convex is:
1. Create a "placeholder" assistant message in the database immediately
2. Use `streamText()` instead of `generateText()` from the AI SDK
3. Periodically update the message content via mutations as tokens arrive
4. The Convex reactive query (`useQuery`) automatically pushes updates to the client
5. Mark the message as complete when streaming finishes

### What's missing:
- No `streamText()` usage — entire response generated at once
- No incremental message updates during generation
- No streaming status field on messages to distinguish "still generating" from "complete"
- User waits 10-30 seconds with just animated dots instead of seeing the response build up

## Requirements

### 1. Add a `streaming` field to messages schema

Update `convex/schema.ts` to add an optional `streaming` boolean field to the messages table:

```typescript
messages: defineTable({
  sessionId: v.id("sessions"),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  timestamp: v.number(),
  streaming: v.optional(v.boolean()),
  changes: v.optional(
    v.object({
      files: v.array(v.string()),
      committed: v.boolean(),
      commitSha: v.optional(v.string()),
      prUrl: v.optional(v.string()),
    }),
  ),
}).index("by_sessionId", ["sessionId"]),
```

### 2. Add mutations for streaming message management in `convex/messages.ts`

Add these mutations:

```typescript
export const createStreamingMessage = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      streaming: true,
    });
  },
});

export const updateStreamingContent = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      content: args.content,
    });
  },
});

export const finalizeStreamingMessage = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    changes: v.optional(
      v.object({
        files: v.array(v.string()),
        committed: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      content: args.content,
      streaming: false,
      ...(args.changes ? { changes: args.changes } : {}),
    });
  },
});
```

### 3. Update `convex/ai.ts` to use `streamText()` with incremental updates

Replace `generateText()` with `streamText()` from the Vercel AI SDK:

```typescript
import { streamText, type LanguageModel } from "ai";
```

Key changes to the `generateResponse` action handler:

1. **Create placeholder message immediately** — so the user sees an assistant bubble right away:
```typescript
const messageId = await ctx.runMutation(api.messages.createStreamingMessage, {
  sessionId: args.sessionId,
});
```

2. **Use `streamText()` instead of `generateText()`:**
```typescript
const result = streamText({
  model,
  system: systemPrompt,
  messages: recentMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  })),
});
```

3. **Collect chunks and periodically flush to the database** — don't update on every single token (too many mutations). Instead, buffer and flush every ~300ms or ~100 characters:
```typescript
let accumulated = "";
let lastFlush = Date.now();
const FLUSH_INTERVAL = 300; // ms
const MIN_FLUSH_CHARS = 50;

for await (const chunk of result.textStream) {
  accumulated += chunk;

  const now = Date.now();
  if (
    now - lastFlush > FLUSH_INTERVAL &&
    accumulated.length > MIN_FLUSH_CHARS
  ) {
    // Show only the explanation part while streaming (don't show raw <file> tags)
    const displayContent = extractDisplayContent(accumulated);
    await ctx.runMutation(api.messages.updateStreamingContent, {
      messageId,
      content: displayContent,
    });
    lastFlush = now;
  }
}
```

4. **After streaming completes**, parse the full text for file blocks and finalize:
```typescript
const fullText = accumulated;
const explanation = parseExplanation(fullText);
const fileChanges = parseFileBlocks(fullText);
const changedPaths = fileChanges.map((f) => f.path);

await ctx.runMutation(api.messages.finalizeStreamingMessage, {
  messageId,
  content: explanation,
  ...(changedPaths.length > 0
    ? { changes: { files: changedPaths, committed: false } }
    : {}),
});
```

5. **Add a helper to extract display-safe content while streaming:**
```typescript
function extractDisplayContent(text: string): string {
  // While streaming, show the explanation and indicate file edits in progress
  // Strip any partial <file> blocks that are still being generated
  const explMatch = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (explMatch) {
    // Explanation is complete — show it, plus a note if file content is coming
    const afterExpl = text.slice(text.indexOf("</explanation>") + "</explanation>".length);
    const hasFileStart = afterExpl.includes("<file");
    let content = explMatch[1].trim();
    if (hasFileStart) {
      content += "\n\n*Editing files...*";
    }
    return content;
  }
  // Explanation still being generated — strip any partial XML tags from the end
  const cleaned = text.replace(/<[^>]*$/, "").replace(/<explanation>/g, "").trim();
  return cleaned || "Thinking...";
}
```

6. **Error handling** — if streaming fails mid-way, finalize the message with an error:
```typescript
try {
  // ... streaming loop ...
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  await ctx.runMutation(api.messages.finalizeStreamingMessage, {
    messageId,
    content: `Sorry, I ran into an error generating a response: ${errorMessage}`,
  });
}
```

### 4. Update `src/components/chat/MessageBubble.tsx` to show streaming state

Add a subtle indicator for messages still being generated:

- If `message.streaming` is true, show a small pulsing cursor (▍) at the end of the content
- This gives visual feedback that more content is coming
- When `streaming` becomes false, the cursor disappears

```tsx
// In MessageBubble, after the MarkdownContent:
{message.streaming && (
  <span className="inline-block animate-pulse text-zinc-400">▍</span>
)}
```

### 5. Update `src/components/chat/ChatPanel.tsx` to remove typing indicator dependency

Currently `ChatPanel` tracks `sending` state and passes `isTyping={sending}` to `MessageList`. With streaming:
- The typing indicator (`TypingIndicator.tsx`) is no longer needed — the streaming message itself provides feedback
- The `sending` state should still be used to **disable the input** while a response is being generated
- Remove `isTyping` prop from `MessageList`
- Remove the `TypingIndicator` import from `MessageList.tsx`
- Remove the typing indicator rendering from `MessageList`

Wait — actually, keep a lightweight approach. The typing indicator can still show briefly in the gap between sending the user message and the first streaming content appearing. So:
- Keep `sending` state and disable input while true
- Remove the `isTyping` prop from MessageList — instead, let the streaming message's own `streaming` field handle the visual indicator
- Remove the TypingIndicator from MessageList

### 6. Run codegen and verify

- Run `npm -s convex codegen` after schema change
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `streaming: v.optional(v.boolean())` to messages table |
| `convex/messages.ts` | **Modify** | Add `createStreamingMessage`, `updateStreamingContent`, `finalizeStreamingMessage` mutations |
| `convex/ai.ts` | **Modify** | Replace `generateText` with `streamText`, add incremental database updates, add `extractDisplayContent` helper |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Add streaming cursor indicator for messages with `streaming: true` |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Remove `isTyping` prop from MessageList usage |
| `src/components/chat/MessageList.tsx` | **Modify** | Remove `isTyping` prop and TypingIndicator rendering |

## Acceptance Criteria

1. When the user sends a message, an assistant message bubble appears immediately (with empty or "Thinking..." content)
2. The assistant message content updates incrementally as tokens stream in — the user sees text appearing progressively
3. While streaming, a pulsing cursor (▍) shows at the end of the content
4. The explanation text is shown as it streams; `<file>` block contents are hidden during streaming (replaced with "Editing files..." note)
5. When streaming completes, the final message content is set, `streaming` becomes false, file changes are parsed and stored
6. File changes are applied to the WebContainer only after streaming is complete (existing behavior via `latestChange` effect)
7. The input is disabled while a response is being generated
8. If streaming fails mid-way, an error message is shown in the assistant bubble
9. The old `TypingIndicator` dots are no longer shown at the bottom of the message list
10. `npm -s convex codegen` runs without errors
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `streamText()` function from `ai` returns an `AsyncIterable` on `result.textStream` — this works in Convex Node.js actions
- Don't flush on every token — batch updates every ~300ms to avoid hammering the database with mutations. The Convex reactive system will push changes to the client on each update
- The `extractDisplayContent` helper prevents raw XML tags (`<file>`, `<explanation>`) from appearing in the chat UI during streaming
- After streaming completes, the full raw text is available for parsing file blocks — same logic as before
- The `streaming` field on messages is `optional` so existing messages (from before this change) work fine — they'll be treated as non-streaming
- The `createStreamingMessage` mutation creates the message with `streaming: true` and empty content — the reactive query in the ChatPanel will immediately show this new message

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/schema.ts` | Added `streaming: v.optional(v.boolean())` field to messages table |
| `convex/messages.ts` | Added `createStreamingMessage`, `updateStreamingContent`, and `finalizeStreamingMessage` mutations |
| `convex/ai.ts` | Replaced `generateText()` with `streamText()`, added `extractDisplayContent` helper, implemented incremental DB updates every ~300ms during streaming, two-layer error handling (inner for streaming failures, outer for setup failures) |
| `src/components/chat/MessageBubble.tsx` | Added `streaming` prop, shows "Thinking..." for empty streaming messages, pulsing cursor (▍) during streaming |
| `src/components/chat/ChatPanel.tsx` | Removed `isTyping` prop from `MessageList` usage |
| `src/components/chat/MessageList.tsx` | Removed `TypingIndicator` import and rendering, removed `isTyping` prop, added `streaming` field to Message interface, passes `streaming` prop to `MessageBubble`, auto-scrolls on content changes during streaming |

### What Was Built
- Token-by-token streaming of AI responses via Convex reactive queries
- Placeholder assistant message appears immediately when user sends a message
- Content updates incrementally (~300ms intervals) as tokens stream in
- Pulsing cursor indicator while streaming is active
- `extractDisplayContent` strips raw XML tags during streaming, shows "Editing files..." when file blocks are being generated
- Error handling finalizes the streaming message with an error if streaming fails mid-way
- Old `TypingIndicator` dots removed in favor of the streaming message itself providing feedback

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed (production build succeeds)
- Browser test — app renders correctly, login/signup pages functional

## Review (e4a40e68)

**Reviewed all 6 modified files. No code issues found; confirmed a previously-broken state was fixed by concurrent work.**

Checks performed:
- `convex/schema.ts` — `streaming: v.optional(v.boolean())` correctly added to messages table. Field is optional so backward-compatible with existing messages.
- `convex/messages.ts` — `createStreamingMessage` correctly inserts with `streaming: true` and empty content. `updateStreamingContent` correctly patches content only. `finalizeStreamingMessage` correctly sets `streaming: false` and optionally sets changes. All argument validators match schema.
- `convex/ai.ts` — `streamText` imported correctly from `ai` SDK. `extractDisplayContent` helper correctly strips partial XML tags during streaming and shows "Editing files..." when `<file` tags are detected. Streaming loop buffers with 300ms / 50-char flush threshold (reasonable). Two-layer try/catch for setup vs streaming errors — inner catch finalizes the streaming message, outer catch uses `messages.send` fallback (correct since messageId may not exist yet). `parseFileBlocks` and `parseExplanation` unchanged and correct.
- `src/components/chat/MessageBubble.tsx` — `streaming` prop added to interface. Conditional rendering: empty content + streaming shows "Thinking...", non-empty content uses `MarkdownContent`, pulsing cursor shown when `streaming` is true. Correct.
- `src/components/chat/MessageList.tsx` — `streaming` field added to Message interface. `hasStreaming` computed for scroll effect dependency. `streaming` prop passed through to `MessageBubble`. Auto-scroll triggers on content changes of last message (for streaming updates). Correct.
- `src/components/chat/ChatPanel.tsx` — `SessionPicker` now receives `onDeleteSession` and `onRenameSession` props (was a TS error caught during review; fixed by concurrent agent adding `handleDeleteSession` and `handleRenameSession` handlers that call `deleteSessionMutation` and `renameSessionMutation`).
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed from this review

## Review (bdfd0d50)

**Re-reviewed all streaming-related files. No new issues found.** Schema, mutations, action, and UI components are all consistent and correct. Both `npx -s tsc -p tsconfig.json --noEmit` and `npx -s convex codegen` pass. No fixes needed.

## Review (83ae8b15)

**Full review of all streaming files. No issues found.** `convex/messages.ts` streaming mutations consistent with schema. `convex/ai.ts` streaming loop with 300ms/50-char flush threshold is reasonable. `extractDisplayContent` correctly strips partial XML. `MessageBubble` and `MessageList` streaming UI correct. `tsc --noEmit` and `convex codegen` pass. No fixes needed.
