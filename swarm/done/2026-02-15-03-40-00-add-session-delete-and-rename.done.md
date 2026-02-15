# Task: Add Session Deletion and Renaming

## Context

The workspace supports multiple chat sessions per repo. Users can create new sessions and switch between them via `SessionPicker`. However, there's no way to **delete** old sessions or **rename** them to something meaningful. As users accumulate sessions, the picker becomes cluttered with entries like "Session from Feb 15, 3:00 PM" that are hard to distinguish and impossible to clean up.

### What exists now:
- `convex/sessions.ts` — Has `create`, `listByRepo`, `get`, and `updateLastActive` mutations/queries. No delete or rename.
- `src/components/chat/SessionPicker.tsx` — Dropdown showing sessions with their `firstMessage` preview text or creation timestamp. Has a "New Session" button. No delete or rename controls.
- `convex/schema.ts` — `sessions` table has: `repoId`, `userId`, `createdAt`, `lastActiveAt`, `previewCode`, `firstMessage`. No `name` field.
- `convex/messages.ts` — Messages are linked to sessions via `sessionId`.
- `convex/fileChanges.ts` — File changes are linked to sessions via `sessionId`.

### What's missing:
- No `name` field on sessions (for user-chosen names)
- No `deleteSession` mutation
- No `renameSession` mutation
- No delete/rename UI in the SessionPicker

## Requirements

### 1. Add optional `name` field to sessions schema (`convex/schema.ts`)

Add an optional `name` field to the sessions table:

```typescript
sessions: defineTable({
  repoId: v.id("repos"),
  userId: v.id("users"),
  createdAt: v.number(),
  lastActiveAt: v.number(),
  previewCode: v.optional(v.string()),
  firstMessage: v.optional(v.string()),
  name: v.optional(v.string()),
}).index("by_repoId", ["repoId"])
  .index("by_userId", ["userId"]),
```

### 2. Add `renameSession` mutation to `convex/sessions.ts`

```typescript
export const renameSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    await ctx.db.patch("sessions", args.sessionId, {
      name: args.name.trim() || undefined, // clear name if empty string
    });
  },
});
```

### 3. Add `deleteSession` mutation to `convex/sessions.ts`

Deleting a session should also clean up its messages and file changes:

```typescript
export const deleteSession = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    // Delete all messages in this session
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    await Promise.all(messages.map((m) => ctx.db.delete("messages", m._id)));

    // Delete all file changes in this session
    const fileChanges = await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    await Promise.all(fileChanges.map((fc) => ctx.db.delete("fileChanges", fc._id)));

    // Delete the session itself
    await ctx.db.delete("sessions", args.sessionId);
  },
});
```

### 4. Update `src/components/chat/SessionPicker.tsx` with rename and delete controls

Add inline rename and a delete button for each session entry in the dropdown:

- **Rename**: Double-click on a session name to enter edit mode. Show a small text input. Press Enter to save, Escape to cancel.
- **Delete**: Show a small trash icon on hover for each session. Clicking it triggers a confirmation dialog (use the existing `ConfirmDialog` component). If the deleted session is the currently active one, switch to the next available session or create a new one.

Display logic for session label:
1. If `session.name` exists, show it
2. Else if `session.firstMessage` exists, show first 40 chars of it
3. Else show `"Session from {formatted date}"`

### 5. Update `src/components/chat/ChatPanel.tsx` to handle session deletion

When the active session is deleted:
- If other sessions exist, switch to the most recent one
- If no sessions remain, the existing "start a new session" state should handle it naturally

### 6. Run codegen and verify

- Run `npm -s convex codegen` after schema change
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `name: v.optional(v.string())` to sessions table |
| `convex/sessions.ts` | **Modify** | Add `renameSession` and `deleteSession` mutations |
| `src/components/chat/SessionPicker.tsx` | **Modify** | Add rename (double-click to edit) and delete (trash icon + confirm) UI |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Handle active session deletion — switch to next session or create new |

## Acceptance Criteria

1. Users can rename a session by double-clicking its name in the SessionPicker and typing a new name
2. The renamed session shows its custom name instead of the auto-generated label
3. Users can delete a session via a trash icon in the SessionPicker (with confirmation dialog)
4. Deleting a session also deletes its messages and file changes from the database
5. Deleting the currently active session switches to the next most recent session
6. Deleting the only remaining session leaves the user in "no session" state, ready to start a new one
7. Session labels show: custom name > first message preview > creation date, in priority order
8. `npm -s convex codegen` runs without errors
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `Promise.all` for bulk deleting messages and file changes (per CLAUDE.md performance guidance)
- The `name` field is optional — existing sessions work fine without it (backward compatible)
- Use the existing `ConfirmDialog` component for delete confirmation
- The `firstMessage` field already provides a decent auto-label; the `name` field is for user customization on top of that
- Keep the SessionPicker compact — rename and delete controls should appear on hover or via a small "..." menu to avoid visual clutter

---

## Implementation Summary

### Files Modified
| File | Changes |
|------|---------|
| `convex/schema.ts` | Added `name: v.optional(v.string())` to the sessions table definition |
| `convex/sessions.ts` | Added `renameSession` mutation (auth-gated, trims name, clears if empty) and `deleteSession` mutation (auth-gated, cascading delete of messages + file changes via Promise.all) |
| `src/components/chat/SessionPicker.tsx` | Added `getSessionLabel()` function (name > firstMessage > date priority), double-click-to-rename with inline text input (Enter to save, Escape to cancel), trash icon on hover for each session with ConfirmDialog delete confirmation, new `onDeleteSession` and `onRenameSession` callback props |
| `src/components/chat/ChatPanel.tsx` | Added `deleteSessionMutation` and `renameSessionMutation` hooks, `handleDeleteSession` (switches to most recent remaining session or null on active deletion), `handleRenameSession`, wired both to SessionPicker |

### What Was Built
- **Session renaming**: Double-click a session in the picker to rename it. The name is stored in the `name` field and displayed with priority over auto-generated labels.
- **Session deletion**: Trash icon appears on hover for each session row. Clicking opens a danger-variant ConfirmDialog. Deletion cascades to remove all associated messages and file changes.
- **Active session handling**: Deleting the active session switches to the most recent remaining session, or resets to "no session" state if none remain.
- **Session label priority**: name > first 40 chars of firstMessage > formatted creation date. When a custom name exists and firstMessage is present, the firstMessage is shown as a subtitle.

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed (production build successful)

## Review (83ae8b15)

**Reviewed `convex/schema.ts`, `convex/sessions.ts`, `src/components/chat/SessionPicker.tsx`, `src/components/chat/ChatPanel.tsx`, and `src/components/ui/ConfirmDialog.tsx`. No issues found.**

Checks performed:
- `convex/schema.ts` — `name: v.optional(v.string())` correctly added to sessions table. Optional field, backward compatible.
- `convex/sessions.ts` — `renameSession` correctly auth-gated with `getAuthUserId`, trims name, clears with `undefined` on empty string. `deleteSession` correctly cascades delete to messages and fileChanges using `Promise.all` for parallel deletion. Both query correct indexes.
- `src/components/chat/SessionPicker.tsx` — `"use client"` present. `getSessionLabel` priority correct (name > firstMessage > date). Double-click rename with inline input, Enter/Escape/blur handlers correct. Delete with trash icon on hover, opens `ConfirmDialog` with danger variant. Click-outside handler correctly closes dropdown and cancels editing.
- `src/components/chat/ChatPanel.tsx` — `handleDeleteSession` correctly switches to next remaining session or null. `handleRenameSession` wired correctly. Both handlers passed to `SessionPicker` as props.
- `src/components/ui/ConfirmDialog.tsx` — Modal with Escape key handler, backdrop click to close, focus management, loading state — all correct.
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed
