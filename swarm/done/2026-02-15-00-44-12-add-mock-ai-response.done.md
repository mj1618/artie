# Task: Add Mock AI Assistant Response to Chat Flow

## Context

The chat panel is fully wired to Convex — users can type messages that are persisted and reactively displayed via `api.messages.send` and `api.messages.list`. However, only user messages appear. There is no assistant response, so the chat feels one-sided.

Before integrating a real LLM (which requires installing the Vercel AI SDK, Anthropic SDK, setting up API keys, etc.), we need to close the loop with a mock assistant response. This creates the full send → reply → display cycle and establishes the pattern that real AI integration will follow.

### What exists now:
- `convex/sessions.ts` — session CRUD + `createDemo` mutation
- `convex/messages.ts` — `send` mutation (inserts a message), `list` query (by sessionId)
- `src/components/chat/ChatPanel.tsx` — sends user messages via `api.messages.send`, displays messages via `useQuery(api.messages.list)`
- `src/components/chat/MessageList.tsx` and `MessageBubble.tsx` — render messages with role-based styling (user right-aligned, assistant left-aligned)

### What this task adds:
A Convex mutation (or action) that automatically generates a mock assistant reply when a user sends a message. This will later be swapped out for a real LLM call.

## Requirements

### 1. Create `convex/ai.ts` — Mock AI response handler

Create a new Convex file with a mutation that generates a mock assistant response:

```typescript
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const generateResponse = mutation({
  args: {
    sessionId: v.id("sessions"),
    userMessage: v.string(),
  },
  handler: async (ctx, args) => {
    // Simulate a brief "thinking" delay is not needed in a mutation
    // Just insert a mock assistant message

    const mockResponses = [
      `I can help you with that! You said: "${args.userMessage}". Once I'm connected to an AI model, I'll be able to make actual code changes.`,
      `Got it! I'll work on that. For now, this is a placeholder response. Real AI integration is coming soon.`,
      `I understand you'd like to: "${args.userMessage}". I'm currently running in demo mode — real code generation will be available when the AI backend is connected.`,
      `Thanks for the request! In the full version, I'd analyze your codebase and generate changes. Here's what I understood: "${args.userMessage}"`,
    ];

    const content = mockResponses[Math.floor(Math.random() * mockResponses.length)];

    await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: "assistant",
      content,
      timestamp: Date.now(),
    });
  },
});
```

### 2. Update `src/components/chat/ChatPanel.tsx` — Trigger mock AI response after user sends

After the user message is sent successfully, call the `api.ai.generateResponse` mutation to create a mock assistant reply:

- Import `api.ai.generateResponse`
- After `await sendMessage(...)` succeeds, call `await generateResponse({ sessionId, userMessage: trimmed })`
- The assistant reply will appear automatically via the reactive `useQuery` on messages

The flow becomes:
1. User types message and hits Send
2. User message is persisted → appears in chat (via reactivity)
3. Mock AI response is generated → appears in chat (via reactivity)
4. Input re-enables

### 3. Run codegen and verify

- Run `npm -s convex codegen` to register the new `ai` module
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/ai.ts` | **Create** | Mock AI response mutation `generateResponse` |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Call `api.ai.generateResponse` after sending a user message |

## Acceptance Criteria

1. When a user sends a message, a mock assistant response automatically appears after it in the chat
2. The assistant response is displayed left-aligned with "Artie" label (existing MessageBubble styling)
3. The mock response references the user's message content to demonstrate the input → output flow
4. `npm -s convex codegen` completes successfully
5. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
6. The send button remains disabled while both the user message send AND the AI response generation are in progress
7. No existing functionality is broken — layout, session creation, message display all still work

## Tech Notes

- Use a `mutation` (not an `action`) for the mock response since it's just a database insert — no external API calls needed yet. When real LLM integration happens, this will become an `action` that calls the AI API and then inserts the response.
- The reactive `useQuery(api.messages.list)` will automatically pick up the new assistant message — no manual state management needed on the frontend.
- Keep the mock responses varied but clearly labeled as demo/placeholder so users know real AI isn't connected yet.
- Import the mutation in ChatPanel using `useMutation(api.ai.generateResponse)`.
- The `sending` state in ChatPanel should stay `true` until both the user message send and AI response generation complete.
- Use `ctx.db.insert("messages", ...)` for the message insertion (standard Convex pattern).
- Don't add any npm dependencies — this is pure Convex + existing React code.

---

## Completion Summary

### Files Created
- **`convex/ai.ts`** — New Convex mutation `generateResponse` that picks a random mock assistant reply (from 4 varied templates that reference the user's message) and inserts it into the `messages` table.

### Files Modified
- **`src/components/chat/ChatPanel.tsx`** — Added `useMutation(api.ai.generateResponse)` hook and wired it into `handleSubmit` so that after the user message is sent, the mock AI response is generated. The `sending` state stays `true` through both operations, keeping the send button disabled during the full cycle.

### Verification
- `npx -s convex codegen` completed successfully
- `npx -s tsc -p tsconfig.json --noEmit` passed with no errors

### Notes for Future Tasks
- When real LLM integration is added, `convex/ai.ts` should be converted from a `mutation` to an `action` (since it will need to call external AI APIs). The action would then use `ctx.runMutation` to insert the response message.
- No new npm dependencies were added.
