# Task: Add Typing Indicator to Chat Panel

## Context

When a user sends a message in the workspace chat, the `generateResponse` action runs for 5–15 seconds. During this time there is **no visual feedback** that the AI is working — the user sees their sent message and nothing else until the full response appears. This is the single most impactful UX gap in the chat experience.

### What exists now:
- `src/components/chat/ChatPanel.tsx` — Has a `sending` boolean state that's `true` while `generateResponse` runs, but only uses it to disable the input
- `src/components/chat/MessageList.tsx` — Renders a list of `MessageBubble` components; no support for a typing indicator
- `src/components/chat/MessageBubble.tsx` — Renders individual messages

### What's missing:
- No "Artie is thinking..." indicator while the AI generates a response
- No animated dots or progress indicator
- The `sending` state isn't passed to MessageList at all

## Requirements

### 1. Create `src/components/chat/TypingIndicator.tsx`

A small component that shows an animated "thinking" indicator in the style of an assistant message bubble.

```tsx
export function TypingIndicator() {
  return (
    <div className="flex flex-col items-start">
      <span className="mb-1 text-xs text-zinc-400">Artie</span>
      <div className="mr-auto rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
```

The three bouncing dots give clear feedback that the AI is working, and the bubble style matches the assistant message bubble from `MessageBubble.tsx`.

### 2. Update `src/components/chat/MessageList.tsx`

- Add an `isTyping` prop to `MessageListProps`
- When `isTyping` is true, render `<TypingIndicator />` at the bottom of the message list (before the scroll anchor)
- The auto-scroll effect should also trigger when `isTyping` changes (so the indicator scrolls into view)

### 3. Update `src/components/chat/ChatPanel.tsx`

- Pass `isTyping={sending}` to `<MessageList />`

That's it — the `sending` state already exists and tracks exactly the right lifecycle (true from submit until AI response completes).

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/TypingIndicator.tsx` | **Create** | Animated bouncing-dots typing indicator component |
| `src/components/chat/MessageList.tsx` | **Modify** | Add `isTyping` prop, render TypingIndicator when true |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Pass `isTyping={sending}` to MessageList |

## Acceptance Criteria

1. When the user sends a message, a typing indicator with three bouncing dots appears immediately at the bottom of the chat
2. The indicator is styled like an assistant message (left-aligned, same background color)
3. The indicator has "Artie" label above it (matching the assistant label from MessageBubble)
4. The dots animate with a staggered bounce effect
5. The indicator disappears once the AI response message arrives
6. The chat auto-scrolls to show the typing indicator
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use Tailwind's built-in `animate-bounce` class with `animationDelay` via inline styles for the staggered effect
- The `sending` state in ChatPanel already covers the exact right window (from form submit to response arrival)
- Don't over-engineer this — no need for streaming text, progress bars, or phase indicators. Just dots.
- The typing indicator is a purely visual component with no data dependencies or hooks
- Keep it small — under 20 lines of code

---

## Completion Summary

### Agent: 6bd7eb08

### Files Changed:
| File | Action |
|------|--------|
| `src/components/chat/TypingIndicator.tsx` | **Created** — 14-line component with three staggered bouncing dots in an assistant-style bubble with "Artie" label |
| `src/components/chat/MessageList.tsx` | **Modified** — Added `isTyping` optional prop, imported and rendered `<TypingIndicator />` before scroll anchor when typing, added `isTyping` to scroll effect dependency |
| `src/components/chat/ChatPanel.tsx` | **Modified** — Passed `isTyping={sending}` to `<MessageList />` |

### Verification:
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed (production build succeeded)
- Browser testing: App renders correctly. Could not test chat panel end-to-end due to missing `JWT_PRIVATE_KEY` env var on Convex backend (auth signup/login fails). The TypingIndicator is a pure presentational component with no data dependencies — it renders when `isTyping={true}` is passed.

## Review (6c44250e)

**Reviewed all 3 files (1 created, 2 modified). No issues found.**

Checks performed:
- `TypingIndicator.tsx` — Pure presentational component, no `"use client"` needed (no hooks/state). Exports named function. Bouncing dots use `animate-bounce` with staggered `animationDelay` via inline styles. Styling matches assistant message bubble from `MessageBubble.tsx` (left-aligned, `bg-zinc-100 dark:bg-zinc-800`, "Artie" label above).
- `MessageList.tsx` — `"use client"` directive present. `isTyping` prop correctly typed as optional boolean. `TypingIndicator` imported and rendered conditionally before the scroll anchor `div`. `isTyping` correctly added to `useEffect` scroll dependency array so the indicator scrolls into view.
- `ChatPanel.tsx` — `"use client"` directive present. Passes `isTyping={sending}` to `MessageList`. The `sending` state lifecycle is correct (set true on submit, false in `finally` block after `generateResponse` completes or errors).
- All imports resolve correctly (`@/components/chat/TypingIndicator`, `@/components/chat/MessageBubble`, relative `convex/_generated` paths)
- No TypeScript issues — `npx -s tsc -p tsconfig.json --noEmit` passes
- `npx -s convex codegen` passes
- No fixes needed — all code is clean
