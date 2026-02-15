# Task: Build Convex Backend Functions for Sessions and Messages

## Context

The Convex schema is complete with all 7 tables (including `sessions` and `messages`), and the workspace layout shell is built with placeholder ChatPanel and PreviewPanel components. However, no Convex backend functions exist yet — there are no queries, mutations, or actions beyond the schema definition.

Before the chat interface can be wired up (Phase 3), we need the data layer: Convex queries and mutations for creating/listing sessions and sending/listing messages. This task builds that foundation.

The ChatPanel currently manages local input state but doesn't talk to Convex. After this task, the backend will be ready for the ChatPanel to connect to.

## Requirements

### 1. Create `convex/sessions.ts` — Session queries and mutations

**Mutations:**

- `create` — Create a new chat session
  - Args: `repoId` (Id<"repos">), `userId` (string)
  - Creates a session with `createdAt` and `lastActiveAt` set to `Date.now()`
  - Returns the new session ID

- `updateLastActive` — Update the `lastActiveAt` timestamp on a session
  - Args: `sessionId` (Id<"sessions">)
  - Patches the session's `lastActiveAt` to `Date.now()`

**Queries:**

- `listByRepo` — List all sessions for a given repo, ordered by most recent
  - Args: `repoId` (Id<"repos">)
  - Uses the `by_repoId` index
  - Returns sessions ordered by `_creationTime` descending (use `.order("desc")`)

- `get` — Get a single session by ID
  - Args: `sessionId` (Id<"sessions">)
  - Returns the session document or null

### 2. Create `convex/messages.ts` — Message queries and mutations

**Mutations:**

- `send` — Send a message in a session
  - Args: `sessionId` (Id<"sessions">), `role` ("user" | "assistant"), `content` (string)
  - Creates a message with `timestamp` set to `Date.now()`
  - Also updates the session's `lastActiveAt` via the sessions mutation (or inline patch)
  - Returns the new message ID

- `markChangesCommitted` — Update the `changes` field on an assistant message (for when code changes are committed to GitHub)
  - Args: `messageId` (Id<"messages">), `commitSha` (string), `prUrl` (optional string)
  - Patches the message's `changes.committed` to `true` and sets the `commitSha` (and `prUrl` if provided)

**Queries:**

- `list` — List all messages for a session, ordered by timestamp
  - Args: `sessionId` (Id<"sessions">)
  - Uses the `by_sessionId` index
  - Returns messages in ascending order (oldest first) — use `.order("asc")`

### 3. Create `convex/projects.ts` — Project/repo helpers (minimal)

For now, create a simple query that will support the workspace:

**Queries:**

- `get` — Get a single repo by ID
  - Args: `repoId` (Id<"repos">)
  - Returns the repo document or null

- `listByTeam` — List all repos for a team
  - Args: `teamId` (Id<"teams">)
  - Uses the `by_teamId` index

### 4. Run Convex codegen

After creating all backend files, run `npm -s convex codegen` to regenerate the `_generated` directory so the new API endpoints are available.

### 5. Verify TypeScript compiles

Run `npm -s tsc -p tsconfig.json --noEmit` to ensure no TS errors across both the Convex backend and frontend.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/sessions.ts` | **Create** | Session CRUD: create, get, listByRepo, updateLastActive |
| `convex/messages.ts` | **Create** | Message CRUD: send, list, markChangesCommitted |
| `convex/projects.ts` | **Create** | Repo queries: get, listByTeam |

## Acceptance Criteria

1. `convex/sessions.ts` exports `create` (mutation), `updateLastActive` (mutation), `listByRepo` (query), `get` (query) — all with proper Convex arg validators and return types
2. `convex/messages.ts` exports `send` (mutation), `list` (query), `markChangesCommitted` (mutation) — all with proper validators
3. `convex/projects.ts` exports `get` (query), `listByTeam` (query)
4. All mutations use appropriate `v.id()` validators for document ID args (e.g., `v.id("sessions")`, `v.id("repos")`)
5. All queries use the correct indexes defined in the schema
6. The `send` mutation also updates the session's `lastActiveAt` field
7. `npm -s convex codegen` completes successfully
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
9. No existing files are broken — the layout, schema, and components all still work

## Tech Notes

- Use `import { query, mutation } from "./_generated/server";` for Convex function constructors
- Use `import { v } from "convex/values";` for validators
- For role validation: `v.union(v.literal("user"), v.literal("assistant"))`
- Use `ctx.db.get("tableName", id)` for fetching by ID (two-argument form per CLAUDE.md)
- Use `ctx.db.patch("tableName", id, fields)` for updates (three-argument form per CLAUDE.md)
- Use `ctx.db.delete("tableName", id)` for deletes (two-argument form per CLAUDE.md)
- Use `ctx.db.insert("tableName", fields)` for inserts
- Queries that list documents should use `.withIndex()` for efficient lookups
- Use `.order("desc")` or `.order("asc")` on queries to control sort order
- Collect results with `.collect()` at the end of query chains
- Don't add auth checks yet — that will come when Convex Auth is integrated
- Keep functions focused and simple — no complex business logic yet

---

## Completion Summary

### Files Created

| File | Description |
|------|-------------|
| `convex/sessions.ts` | Session queries and mutations: `create`, `updateLastActive`, `listByRepo`, `get` |
| `convex/messages.ts` | Message queries and mutations: `send`, `list`, `markChangesCommitted` |
| `convex/projects.ts` | Repo queries: `get`, `listByTeam` |

### What Was Implemented

- **convex/sessions.ts**: 2 mutations (`create`, `updateLastActive`) and 2 queries (`listByRepo`, `get`). `create` sets both `createdAt` and `lastActiveAt` to `Date.now()`. `listByRepo` uses the `by_repoId` index with descending order.
- **convex/messages.ts**: 2 mutations (`send`, `markChangesCommitted`) and 1 query (`list`). `send` inserts the message and also patches the session's `lastActiveAt` inline. `markChangesCommitted` preserves the existing `changes` object and sets `committed: true` with the commit SHA/PR URL. `list` uses the `by_sessionId` index with ascending order.
- **convex/projects.ts**: 2 queries (`get`, `listByTeam`). `get` fetches a single repo by ID. `listByTeam` uses the `by_teamId` index.

### Verification

- `npx convex codegen` completed successfully — all three modules appear in `convex/_generated/api.d.ts`
- `npx tsc -p tsconfig.json --noEmit` passes with zero errors
- All existing files (schema, layout, components) remain intact

### Notes for Future Tasks

- No auth checks are implemented yet — these functions are publicly accessible and will need auth guards when Convex Auth is integrated
- The `markChangesCommitted` mutation expects the message to already have a `changes` field — the assistant message creation flow will need to set initial `changes` data when AI generates file modifications
- The ChatPanel can now be wired up to use `api.sessions.create`, `api.messages.send`, and `api.messages.list`
