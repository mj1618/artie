# Task: Add Chat Session History & Management

## Context

The workspace page (`src/app/workspace/[repoId]/page.tsx`) currently creates a new session every time a user visits a repo. There's no way to:
- See previous chat sessions for a repo
- Resume a past session
- Start a new session explicitly
- Delete old sessions

The PLAN.md includes a `sessions` table (already implemented in `convex/sessions.ts`) and the schema supports multiple sessions per repo per user. But the UI doesn't expose session management.

### What exists now:
- `convex/sessions.ts` — Has `create` mutation, `get` query
- `convex/schema.ts` — `sessions` table with `repoId`, `userId`, `createdAt`, `lastActiveAt`
- `convex/messages.ts` — Messages tied to `sessionId`
- `src/app/workspace/[repoId]/page.tsx` — Creates a session via ChatPanel, no session picker
- `src/components/chat/ChatPanel.tsx` — Creates a new session on first message send, no session switching

### What's missing:
- No query to list sessions for a repo
- No session picker UI in the workspace
- No way to resume a previous session
- No way to start a fresh session when one already exists
- No `lastActiveAt` updating when messages are sent

## Requirements

### 1. Add `listByRepo` query to `convex/sessions.ts`

```typescript
export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    return await ctx.db
      .query("sessions")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .order("desc")
      .collect()
      .then(sessions => sessions.filter(s => s.userId === user._id));
  },
});
```

Also add an `updateLastActive` mutation that patches `lastActiveAt` on the session. Call this from `messages.send`.

### 2. Add session index if missing

Check if `sessions` table has a `by_repoId` index. If not, add one:
```typescript
.index("by_repoId", ["repoId"])
```

### 3. Create `src/components/chat/SessionPicker.tsx`

A dropdown/panel that appears at the top of the ChatPanel showing:
- A "New Chat" button to start a fresh session
- A list of previous sessions, each showing:
  - Date/time created (formatted nicely, e.g., "Today at 2:15 PM", "Feb 14 at 9:30 AM")
  - First message preview (truncated to ~50 chars)
  - Relative time ("5 min ago", "2 hours ago")
- Clicking a session switches the active session
- Current session is highlighted

**UI approach:**
- A small dropdown trigger at the top of the chat panel showing the current session label (e.g., "Chat session - Today at 2:15 PM")
- Clicking it opens a dropdown listing all sessions for this repo
- "New Chat" button at the top of the dropdown
- Keep it compact — this isn't the main focus, just a way to switch sessions

### 4. Update `src/components/chat/ChatPanel.tsx`

- Accept an optional `initialSessionId` prop
- If `initialSessionId` is set, load that session's messages
- Add session switching: when user selects a session from SessionPicker, update the sessionId state
- When user clicks "New Chat", set sessionId to null (a new session will be created on first message)
- Call `onSessionCreated` callback when session changes (so workspace page can update)

### 5. Update workspace page

- Query sessions for the repo on load
- If sessions exist, default to the most recent one
- Pass the selected session to ChatPanel

### 6. Update `convex/messages.ts` — touch `lastActiveAt`

In the `send` mutation, after inserting the message, also patch the session's `lastActiveAt`:
```typescript
await ctx.db.patch("sessions", args.sessionId, { lastActiveAt: Date.now() });
```

### 7. Add first message preview to session list

Add a query or modify `listByRepo` to include the first message of each session for preview purposes. Options:
- **Option A**: Fetch first message per session in the query (may be slow with many sessions)
- **Option B**: Store a `firstMessage` summary field on the session when the first message is sent
- **Option C**: Let the frontend query messages separately per session (too many queries)

**Go with Option B**: Add an optional `firstMessage: v.optional(v.string())` field to the sessions schema. Update the `send` mutation to set this field on the first message of a session.

### 8. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/sessions.ts` | **Modify** | Add `listByRepo` query, `updateLastActive` mutation |
| `convex/schema.ts` | **Modify** | Add `by_repoId` index to sessions (if missing), add `firstMessage` field |
| `convex/messages.ts` | **Modify** | Update `send` to touch session `lastActiveAt` and set `firstMessage` on first message |
| `src/components/chat/SessionPicker.tsx` | **Create** | Dropdown for session history and switching |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Support session switching, integrate SessionPicker |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Query sessions on load, default to most recent |

## Acceptance Criteria

1. `sessions.listByRepo` returns all sessions for the current user for a given repo, ordered by most recent first
2. SessionPicker displays previous sessions with date/time and first message preview
3. Clicking a previous session loads its messages in the chat panel
4. "New Chat" button creates a fresh session (on first message send)
5. Current session is highlighted in the session picker
6. `lastActiveAt` is updated whenever a message is sent
7. `firstMessage` field is set on the session when the first user message is sent
8. Workspace page defaults to the most recent session on load
9. `npm -s convex codegen` passes
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Keep SessionPicker lightweight — it's a small dropdown, not a full page
- Sessions ordered by `lastActiveAt` descending so most recently active is first
- Don't load messages for all sessions upfront — only load messages for the active session
- The `firstMessage` field avoids N+1 queries when listing sessions
- Use relative time formatting (Intl.RelativeTimeFormat or simple helper) for session timestamps
- Session switching should be instant since messages are already subscribed via the query

---

## Implementation Summary

### Files Modified
- **`convex/schema.ts`** — Added `firstMessage: v.optional(v.string())` field to the sessions table
- **`convex/sessions.ts`** — Updated `listByRepo` query to filter sessions by the authenticated user (using `getAuthUserId`)
- **`convex/messages.ts`** — Updated `send` mutation to: (1) get the session and check if `firstMessage` is set, (2) set `firstMessage` to the first 100 chars of the first user message, (3) update `lastActiveAt` on every message send
- **`src/components/chat/ChatPanel.tsx`** — Rewrote to accept `sessions`, `initialSessionId`, and `onSessionChange` props; removed auto-session-creation on mount; integrated `SessionPicker` component; creates session on-demand when first message is sent in a new chat
- **`src/app/workspace/[repoId]/page.tsx`** — Added `useQuery` for `sessions.listByRepo`; defaults to most recent session on load; passes sessions list and session state to `ChatPanel`

### Files Created
- **`src/components/chat/SessionPicker.tsx`** — Compact dropdown component at the top of the chat panel showing: current session label, chevron toggle, dropdown with "New Chat" button and list of previous sessions with formatted date/time, relative time, and first message preview (truncated to 50 chars); active session is highlighted; click-outside-to-close behavior

### Additional Fixes
- Fixed circular import between `useToast.tsx` ↔ `ToastContainer.tsx` ↔ `Toast.tsx` by moving `Toast`/`ToastType` type definitions to `ToastContainer.tsx` and re-exporting from `useToast.tsx`

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — no errors in any changed files (pre-existing error in `DashboardSkeleton.tsx` from another task)
- `npm run build` — passed successfully
- Browser test — landing page renders correctly

### Reviewer Pass (e26aa279)
- Reviewed all 6 files (convex/sessions.ts, convex/messages.ts, convex/schema.ts, src/components/chat/SessionPicker.tsx, src/components/chat/ChatPanel.tsx, src/app/workspace/[repoId]/page.tsx)
- `"use client"` directives present on all client components (SessionPicker, ChatPanel, workspace page)
- All imports resolve correctly (api, Id, Doc types, SessionPicker, MessageList, useToast, webcontainer utils)
- Schema has `by_repoId` index on sessions table, `firstMessage` optional field — matches query usage
- `messages.send` correctly patches session with `lastActiveAt` and `firstMessage` on first user message
- SessionPicker handles empty sessions, click-outside-close, active session highlighting
- ChatPanel correctly skips queries with `"skip"` when no sessionId, creates session on-demand
- Workspace page has proper loading, auth redirect, null repo check, and session initialization logic
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed with zero errors
- No fixes needed — all code is clean

### Reviewer Pass (34824841, iteration 4)
- Re-reviewed all session history files (convex/sessions.ts, convex/messages.ts, SessionPicker.tsx, ChatPanel.tsx, workspace page)
- Also cross-checked: convex/schema.ts, convex/fileChanges.ts, convex/ai.ts, convex/github.ts, MessageBubble.tsx, MessageList.tsx, ChangePreview.tsx, Sidebar.tsx, PreviewPanel.tsx, DashboardSkeleton.tsx, webcontainer/files.ts, useToast.tsx, dashboard layout
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed, all routes generated
- No fixes needed — all code is clean and consistent
