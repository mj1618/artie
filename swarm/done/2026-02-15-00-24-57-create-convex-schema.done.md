# Task: Create Convex Schema for Artie Data Model

## Context

The project is a fresh Next.js 16 + React 19 + Tailwind CSS 4 + Convex scaffold. The only Convex file is a boilerplate `tasks` schema and `tasks.ts` with sample CRUD functions. None of the Artie-specific data model exists yet. The schema is the foundation that all backend queries, mutations, and frontend features will build on, so it must be created first.

## Requirements

### 1. Replace `convex/schema.ts` with the Artie data model

Define the following tables with appropriate indexes:

**`userProfiles`** — Extended user profile data (Convex Auth manages the core `users` table)
- `userId` (string — the Convex Auth user ID)
- `displayName` (string)
- `githubAccessToken` (optional string)
- `githubUsername` (optional string)
- Index: `by_userId` on `["userId"]`

**`teams`** — Workspaces/organizations
- `name` (string)
- `ownerId` (string — userId)
- Index: `by_ownerId` on `["ownerId"]`

**`teamMembers`** — Team membership join table
- `teamId` (Id<"teams">)
- `userId` (string)
- `role` ("owner" | "member")
- `invitedAt` (number — timestamp)
- `joinedAt` (optional number)
- Index: `by_teamId` on `["teamId"]`
- Index: `by_userId` on `["userId"]`
- Index: `by_teamId_userId` on `["teamId", "userId"]`

**`invites`** — Pending team invitations
- `teamId` (Id<"teams">)
- `email` (string)
- `invitedBy` (string — userId)
- `createdAt` (number)
- `expiresAt` (number)
- Index: `by_teamId` on `["teamId"]`
- Index: `by_email` on `["email"]`

**`repos`** — Connected GitHub repositories
- `teamId` (Id<"teams">)
- `githubOwner` (string)
- `githubRepo` (string)
- `githubUrl` (string)
- `defaultBranch` (string)
- `pushStrategy` ("direct" | "pr")
- `connectedBy` (string — userId)
- `connectedAt` (number)
- Index: `by_teamId` on `["teamId"]`

**`sessions`** — Chat sessions per repo
- `repoId` (Id<"repos">)
- `userId` (string)
- `createdAt` (number)
- `lastActiveAt` (number)
- Index: `by_repoId` on `["repoId"]`
- Index: `by_userId` on `["userId"]`

**`messages`** — Chat messages within sessions
- `sessionId` (Id<"sessions">)
- `role` ("user" | "assistant")
- `content` (string)
- `timestamp` (number)
- `changes` (optional object with: `files` array of strings, `committed` boolean, optional `commitSha` string, optional `prUrl` string)
- Index: `by_sessionId` on `["sessionId"]`

### 2. Delete `convex/tasks.ts`

The boilerplate tasks file is not needed. Remove it entirely.

### 3. Run Convex codegen

After updating the schema, run `npm -s convex codegen` to regenerate the `_generated` directory.

### 4. Verify no TypeScript errors

Run `npm -s tsc -p tsconfig.json --noEmit` to ensure no TS errors. If `page.tsx` or other files reference the old `tasks` API, update them to remove those references (e.g., replace the default page content with a simple placeholder).

### 5. Clean up `src/app/page.tsx`

Replace the boilerplate Next.js landing page content with a simple Artie placeholder page:
- Show "Artie" as a heading
- Add a subtitle like "AI-Powered Code Preview & Editor"
- Keep it minimal — just enough to confirm the app renders

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Replace boilerplate with full Artie schema |
| `convex/tasks.ts` | **Delete** | Remove boilerplate tasks functions |
| `src/app/page.tsx` | **Modify** | Replace boilerplate with Artie placeholder |

## Acceptance Criteria

1. `convex/schema.ts` defines all 7 tables (`userProfiles`, `teams`, `teamMembers`, `invites`, `repos`, `sessions`, `messages`) with correct field types and indexes
2. `convex/tasks.ts` is deleted
3. `npm -s convex codegen` completes successfully
4. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors (you may need a convex tsconfig — check for `convex/tsconfig.json`)
5. `src/app/page.tsx` shows a simple Artie-branded placeholder (no references to tasks or Next.js boilerplate)
6. The app still runs without errors

## Tech Notes

- Use `v.union(v.literal("owner"), v.literal("member"))` for union/enum types in Convex
- Use `v.optional(...)` for optional fields
- Use `v.object({...})` for nested objects like the `changes` field on messages
- The `userId` fields should be `v.string()` (not `v.id("users")`) since Convex Auth manages the users table and we reference by auth user ID
- Do NOT delete the `convex/_generated/` directory — just run codegen to regenerate it
- Run `npm -s convex codegen` (not `npx`) per project conventions

---

## Completion Summary

### Files Modified
- **`convex/schema.ts`** — Replaced boilerplate `tasks` table with the full Artie data model: `userProfiles`, `teams`, `teamMembers`, `invites`, `repos`, `sessions`, `messages` — all with correct field types, validators, and indexes as specified.

### Files Deleted
- **`convex/tasks.ts`** — Removed the boilerplate CRUD functions for the old `tasks` table.

### Files Updated
- **`src/app/page.tsx`** — Replaced the default Next.js landing page (with Next.js/Vercel branding and images) with a clean Artie placeholder showing the app name and subtitle "AI-Powered Code Preview & Editor".

### Verification
- `npx convex codegen` completed successfully — the `_generated/` directory was regenerated with the new schema (no more `tasks` references).
- `npx tsc -p tsconfig.json --noEmit` passed with zero errors.

### Notes for Future Tasks
- The `userId` fields across all tables use `v.string()` (not `v.id("users")`) since Convex Auth manages the users table separately and we reference users by their auth user ID.
- Union types (roles, push strategies, message roles) use `v.union(v.literal(...), v.literal(...))` pattern.
- The `messages.changes` field is a nested `v.object()` with optional sub-fields for tracking committed changes, commit SHAs, and PR URLs.
