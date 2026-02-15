# Task: Wire Up Chat Panel to Convex (Message List, Send, Session Management)

## Context

The workspace layout is built with a placeholder `ChatPanel` component (`src/components/chat/ChatPanel.tsx`) that has local input state but doesn't communicate with Convex. The Convex backend functions for sessions and messages are complete:

- `api.sessions.create` — creates a new session
- `api.sessions.listByRepo` — lists sessions for a repo
- `api.messages.send` — sends a message (user or assistant)
- `api.messages.list` — lists messages for a session (ascending order)

The `ConvexClientProvider` already wraps the app in `layout.tsx`, so Convex React hooks (`useQuery`, `useMutation`) are available.

Since there's no auth or repo connection yet, this task will use a **demo mode**: create a hardcoded demo session on first load and use it for all messages. This lets us build the full chat UI loop (send message → see it appear) without needing auth or real repos.

## Requirements

### 1. Create `src/components/chat/MessageList.tsx` — Message display component

A component that renders a list of chat messages:

- Props: `messages` — array of message objects from the `api.messages.list` query (each has `role`, `content`, `timestamp`, `_id`)
- Render each message as a bubble/card:
  - **User messages**: Right-aligned, darker background (e.g., `bg-zinc-800 text-white`)
  - **Assistant messages**: Left-aligned, lighter background (e.g., `bg-zinc-100 dark:bg-zinc-800`)
  - Show the message `content` as text
  - Show a subtle timestamp below each message (format as relative time like "just now" or use a simple time format)
- Auto-scroll to the bottom when new messages arrive (use a `useRef` on a bottom sentinel div and `scrollIntoView`)
- When there are no messages, show the existing empty state text: "Start a conversation to preview and edit your code"
- Use `"use client"` directive

### 2. Update `src/components/chat/ChatPanel.tsx` — Wire up to Convex

Transform the placeholder into a functional chat panel:

- **Session management**: Use a `useState` to hold a `sessionId`. On mount, create a demo session using the `useMutation(api.sessions.create)` hook. Since we don't have a real repo, we need to handle this carefully:
  - Add a new Convex mutation `sessions.createDemo` that creates a session without requiring a real `repoId` (see requirement #4 below)
  - Store the returned session ID in state
- **Message listing**: Use `useQuery(api.messages.list, sessionId ? { sessionId } : "skip")` to reactively fetch messages for the current session
- **Sending messages**: On form submit (Enter key or click Send button):
  - Call `api.messages.send` with `sessionId`, `role: "user"`, and `content` from the input
  - Clear the input after sending
  - Disable the send button and input while sending (simple loading state)
- **Render**: Replace the empty state div with the `MessageList` component, passing the messages array
- Keep the input area at the bottom with the same styling

### 3. Create `src/components/chat/MessageBubble.tsx` — Individual message component

A small component for rendering a single message:

- Props: `role` ("user" | "assistant"), `content` (string), `timestamp` (number)
- User messages: right-aligned with `ml-auto max-w-[80%]` and darker styling
- Assistant messages: left-aligned with `mr-auto max-w-[80%]` and lighter styling
- Show role label ("You" / "Artie") above the message in small muted text
- Render content as plain text (no markdown yet — that's a future task)
- `"use client"` directive

### 4. Add `sessions.createDemo` mutation to `convex/sessions.ts`

Add a new mutation that creates a demo session without requiring a valid `repoId`:

```typescript
export const createDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Create a minimal demo repo entry first, then create the session
    const repoId = await ctx.db.insert("repos", {
      teamId: /* need a demo team */ ,
      ...
    });
    // This is complex — simpler approach below
  },
});
```

**Actually, simpler approach**: Instead of creating a demo mutation, just modify the `page.tsx` to pass a `sessionId` prop to `ChatPanel`, and manage the demo session creation at the page level. But since we don't have a valid `repoId` to pass to `sessions.create`, the cleanest approach is:

**Add a `createDemo` mutation to `convex/sessions.ts`**:
```typescript
export const createDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // First, create a demo team if none exists
    const existingTeam = await ctx.db.query("teams").first();
    let teamId;
    if (existingTeam) {
      teamId = existingTeam._id;
    } else {
      teamId = await ctx.db.insert("teams", {
        name: "Demo Team",
        ownerId: "demo-user",
      });
    }

    // Create a demo repo if none exists
    const existingRepo = await ctx.db.query("repos").first();
    let repoId;
    if (existingRepo) {
      repoId = existingRepo._id;
    } else {
      repoId = await ctx.db.insert("repos", {
        teamId,
        githubOwner: "demo",
        githubRepo: "my-project",
        githubUrl: "https://github.com/demo/my-project",
        defaultBranch: "main",
        pushStrategy: "direct" as const,
        connectedBy: "demo-user",
        connectedAt: now,
      });
    }

    // Create the session
    return await ctx.db.insert("sessions", {
      repoId,
      userId: "demo-user",
      createdAt: now,
      lastActiveAt: now,
    });
  },
});
```

This creates minimal scaffolding data so the session and message flow works end-to-end without auth.

### 5. Update `src/app/page.tsx` — Pass session management to ChatPanel

The page should:
- Remain a `"use client"` component
- Import and use the demo session creation
- The `ChatPanel` component will handle its own session internally (self-contained), so the page doesn't need to change much — just keep the existing layout

### 6. Handle loading states

- While the session is being created, show a loading indicator in the chat panel (e.g., "Starting session..." text)
- While messages are loading, show nothing or a subtle spinner
- Disable the input until the session is ready

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/MessageList.tsx` | **Create** | Scrollable message list with auto-scroll |
| `src/components/chat/MessageBubble.tsx` | **Create** | Individual message bubble component |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Wire up to Convex: session creation, message send, message list |
| `convex/sessions.ts` | **Modify** | Add `createDemo` mutation for demo mode |

## Acceptance Criteria

1. When the app loads, a demo session is automatically created (visible in Convex dashboard if running)
2. The user can type a message in the input and press Enter or click Send to send it
3. Sent messages appear immediately in the message list (Convex reactivity)
4. User messages are styled differently from assistant messages (right vs left aligned)
5. The message list auto-scrolls to show the latest message
6. The input is disabled while no session exists (loading state)
7. Empty state shows "Start a conversation to preview and edit your code" when no messages exist
8. `npm -s convex codegen` completes successfully
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
10. No existing files or functionality are broken

## Tech Notes

- Use `useQuery` from `"convex/react"` for reactive message listing — messages will auto-update when new ones are inserted
- Use `useMutation` from `"convex/react"` for sending messages and creating sessions
- For `useQuery` with conditional args, pass `"skip"` as the second argument when the sessionId is not yet available: `useQuery(api.messages.list, sessionId ? { sessionId } : "skip")`
- Use `useRef` + `scrollIntoView({ behavior: "smooth" })` for auto-scrolling
- Use `useEffect` to trigger demo session creation on mount (call the mutation once)
- Use a `useRef` flag to prevent double-creation in React strict mode (mutation called twice)
- Import API types from `@/convex/_generated/api`
- Import `Id` type from `@/convex/_generated/dataModel` if needed for typing sessionId state
- React 19 — no need for `useCallback`/`useMemo` wrappers
- Keep styling consistent with existing components (zinc color palette, dark mode support)
- The send button should only be enabled when input is non-empty AND session exists
- Handle the form submission with both Enter key press and button click

---

## Completion Summary

### Files Created
- **`src/components/chat/MessageBubble.tsx`** — Individual message bubble component with role-based styling (user right-aligned with dark bg, assistant left-aligned with lighter bg), role labels ("You" / "Artie"), and relative timestamp formatting.
- **`src/components/chat/MessageList.tsx`** — Scrollable message list that renders `MessageBubble` components, auto-scrolls to bottom on new messages via `useRef`/`scrollIntoView`, and shows empty state text when no messages exist.

### Files Modified
- **`convex/sessions.ts`** — Added `createDemo` mutation that creates demo team/repo scaffolding if none exists, then creates a session. This enables the full chat loop without auth.
- **`src/components/chat/ChatPanel.tsx`** — Fully wired up to Convex: creates a demo session on mount (with `useRef` guard against React strict mode double-invoke), reactively queries messages via `useQuery`, sends messages via `useMutation`, handles loading/sending states, and renders `MessageList`. Uses `<form>` for both Enter key and button click submission.

### What Was Implemented
- Full chat send/receive loop: user types a message → it's persisted to Convex → reactively appears in the message list
- Demo session auto-creation on first load (no auth required)
- Loading state ("Starting session...") while session is being created
- Input/button disabled states during sending and before session is ready
- Auto-scroll to latest message

### Notes
- The `@/` path alias maps to `./src/*`, so convex generated files (at project root `./convex/_generated/`) are imported via relative paths (`../../../convex/_generated/api`) in `ChatPanel.tsx`.
- The `createDemo` mutation creates a new session on every page load. When auth is implemented, this should be replaced with proper session management.
- No new npm packages were installed.
