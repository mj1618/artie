# Task: Build GitHub Commit & PR Flow

## Context

The AI can now edit project files (stored as `fileChanges` in the database), and the WebContainer shows live previews. The `convex/github.ts` file already has read-only actions (`fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer`). But there's no way to **write back** to GitHub — the user can't approve changes and push them.

This task implements the GitHub commit flow from Phase 5 of the PLAN.md:
- User approves AI-generated changes
- Based on the repo's `pushStrategy` setting (`"direct"` or `"pr"`):
  - **Direct mode**: Commit changes directly to the default branch
  - **PR mode**: Create a new branch, commit changes, open a pull request

### What exists now:
- `convex/github.ts` — Read-only: `fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer` (uses `@octokit/rest`)
- `convex/schema.ts` — `repos` table has `pushStrategy: v.union(v.literal("direct"), v.literal("pr"))`, `githubOwner`, `githubRepo`, `defaultBranch`
- `convex/schema.ts` — `messages` table has `changes?: { files: string[], committed: boolean, commitSha?: string, prUrl?: string }`
- `convex/messages.ts` — Has `markChangesCommitted` mutation
- `convex/schema.ts` — `fileChanges` table (being added by in-progress task) with `sessionId`, `messageId`, `files: [{path, content}]`, `applied`
- `src/components/chat/MessageBubble.tsx` — Currently just shows role + content + timestamp

### What's missing:
- No GitHub **write** actions (commit, branch creation, PR creation)
- No "Approve & Push" button in the UI for the user
- No commit/PR feedback shown to the user after pushing

## Requirements

### 1. Add GitHub write actions to `convex/github.ts`

Add three new actions to the existing `convex/github.ts` file:

**`commitToDefault` action:**
Commits file changes directly to the repo's default branch using the GitHub Contents API. For each changed file, update/create it via `PUT /repos/{owner}/{repo}/contents/{path}`.

```typescript
export const commitToDefault = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Get repo details
    // 2. Get file changes from DB
    // 3. For each file, get the current blob SHA (needed for updates)
    // 4. Commit each file using octokit.repos.createOrUpdateFileContents
    //    (or use the Git Data API to create a single commit with multiple files)
    // 5. Mark message changes as committed with commitSha
    // 6. Return { commitSha, commitUrl }
  },
});
```

**Preferred approach:** Use the **Git Data API** to create a single commit with all file changes (rather than one commit per file). This keeps the history clean:
1. Get the current commit SHA of the default branch
2. Create blobs for each changed file
3. Create a new tree referencing the new blobs
4. Create a commit pointing to the new tree
5. Update the branch ref to the new commit

**`commitToBranch` action:**
Creates a new branch, commits file changes to it, and opens a pull request.

```typescript
export const commitToBranch = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.string(),
    branchName: v.string(),
    prTitle: v.string(),
    prBody: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Get repo details
    // 2. Get the default branch HEAD SHA
    // 3. Create new branch from HEAD
    // 4. Commit files to new branch (same Git Data API approach)
    // 5. Create PR from new branch to default branch
    // 6. Mark message changes as committed with commitSha and prUrl
    // 7. Return { commitSha, prUrl, branchName }
  },
});
```

**`pushChanges` action (high-level orchestrator):**
A single entry point that reads the repo's `pushStrategy` and delegates to the appropriate method.

```typescript
export const pushChanges = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.runQuery(api.projects.get, { repoId: args.repoId });
    const session = /* get session for this message */;
    const fileChange = /* get file change record */;

    // Generate commit message from the AI explanation
    const message = await ctx.runQuery(api.messages.get, { messageId: args.messageId });
    const commitMessage = `Artie: ${message.content.slice(0, 72)}`;

    if (repo.pushStrategy === "direct") {
      return await commitToDefaultInternal(ctx, repo, fileChange, commitMessage, args.messageId);
    } else {
      const branchName = `artie/${Date.now()}`;
      const prTitle = commitMessage;
      const prBody = `## Changes made by Artie\n\n${message.content}\n\n### Files changed\n${fileChange.files.map(f => `- \`${f.path}\``).join("\n")}`;
      return await commitToBranchInternal(ctx, repo, fileChange, commitMessage, branchName, prTitle, prBody, args.messageId);
    }
  },
});
```

### 2. Add `get` query to `convex/messages.ts`

Add a simple query to fetch a single message by ID (needed by `pushChanges`):

```typescript
export const get = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get("messages", args.messageId);
  },
});
```

### 3. Add `getFileChange` query to `convex/fileChanges.ts` (or wherever fileChanges queries live)

If not already present from the in-progress task, add:

```typescript
export const get = query({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    return await ctx.db.get("fileChanges", args.fileChangeId);
  },
});
```

### 4. Add "Approve & Push" button to `MessageBubble.tsx`

When an assistant message has `changes` with `committed === false`, show an "Approve & Push" button. When clicked:
1. Call `pushChanges` action with the message's repoId, messageId, and fileChangeId
2. Show loading state while committing
3. On success: show green "Committed" badge with commit SHA (link to GitHub), or "PR Created" with PR link
4. On failure: show error message with retry option

```tsx
// In MessageBubble, when message.changes exists:
{message.changes && !message.changes.committed && (
  <button onClick={handlePush} disabled={pushing}>
    {pushing ? "Pushing..." : "Approve & Push to GitHub"}
  </button>
)}
{message.changes?.committed && message.changes.prUrl && (
  <a href={message.changes.prUrl} target="_blank">View Pull Request</a>
)}
{message.changes?.committed && message.changes.commitSha && !message.changes.prUrl && (
  <span>Committed: {message.changes.commitSha.slice(0, 7)}</span>
)}
```

### 5. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add `commitToDefault`, `commitToBranch`, `pushChanges` actions using Git Data API |
| `convex/messages.ts` | **Modify** | Add `get` query for fetching single message |
| `convex/fileChanges.ts` | **Modify** | Add `get` query if not already present |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Add "Approve & Push" button, committed status display, PR link |

## Acceptance Criteria

1. `convex/github.ts` exports `pushChanges` action that reads repo push strategy and delegates appropriately
2. Direct mode: commits all changed files to the default branch in a single commit using Git Data API
3. PR mode: creates a new branch, commits files, opens a PR with descriptive title and body
4. `messages.get` query returns a single message by ID
5. After a successful push, the message's `changes.committed` is set to `true` with `commitSha` (and `prUrl` for PR mode)
6. MessageBubble shows "Approve & Push" button for uncommitted changes
7. MessageBubble shows commit SHA or PR link after successful push
8. Loading state shown during push operation
9. Error handling for push failures (network, auth, merge conflicts)
10. `npm -s convex codegen` completes successfully
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- **Git Data API** is preferred over the Contents API for multi-file commits. The Contents API (`PUT /repos/:owner/:repo/contents/:path`) creates one commit per file, which pollutes the history. The Git Data API (`POST /repos/:owner/:repo/git/blobs`, `POST /repos/:owner/:repo/git/trees`, `POST /repos/:owner/:repo/git/commits`, `PATCH /repos/:owner/:repo/git/refs/:ref`) creates a single commit for all changes.
- **Branch naming**: Use `artie/{timestamp}` for auto-generated branch names to avoid conflicts.
- **Commit messages**: Generate from the AI's explanation, truncated to ~72 chars for the first line. Include the full explanation in the commit body.
- **Auth**: Currently uses `process.env.GITHUB_TOKEN`. In the future, this will use the user's own token from their profile.
- **Merge conflicts**: If the default branch has been updated since the files were loaded, the Git Data API will reject the update. Catch this and show a user-friendly "Branch has been updated — please reload the preview" error.
- **The `fileChanges` table** is being added by the in-progress `wire-ai-file-editing-to-webcontainer` task. This task depends on that table existing. If the `fileChanges` table doesn't exist yet when this task runs, the worker should wait or handle the dependency gracefully.
- **`markChangesCommitted`** in `convex/messages.ts` already exists and patches the message's changes with `committed: true`, `commitSha`, and `prUrl`. Reuse it from the `pushChanges` action via `ctx.runMutation`.
- The `pushChanges` action is a Convex action (not mutation) because it makes external API calls to GitHub. It uses `ctx.runQuery` and `ctx.runMutation` internally for database operations.

---

## Completion Summary

### What was built

Implemented the full GitHub commit & PR flow for Artie — users can now approve AI-generated file changes and push them to GitHub.

### Files modified

| File | Changes |
|------|---------|
| `convex/github.ts` | Added `createCommitWithFiles` helper (Git Data API for single multi-file commits), `commitToDefault` action, `commitToBranch` action, and `pushChanges` orchestrator action that reads repo push strategy and delegates |
| `convex/messages.ts` | Added `get` query to fetch a single message by ID |
| `convex/fileChanges.ts` | Added `get` query to fetch a single file change by ID, and `listBySession` query to list all file changes for a session |
| `src/components/chat/MessageBubble.tsx` | Added "Approve & Push to GitHub" button for uncommitted changes, green "Committed" badge with commit SHA, purple "View Pull Request" link for PR mode, loading/error states |
| `src/components/chat/MessageList.tsx` | Updated to pass `repoId`, `fileChangesByMessageId`, full `changes` object (including `commitSha`, `prUrl`) to MessageBubble |
| `src/components/chat/ChatPanel.tsx` | Added `listBySession` query subscription, builds `fileChangesByMessageId` map, passes `repoId` and map to MessageList |
| `src/components/layout/Sidebar.tsx` | Fixed pre-existing broken import path (`@/convex/` → relative path) |

### Key design decisions

- Used **Git Data API** (blobs → tree → commit → update ref) for single multi-file commits instead of Contents API (one commit per file)
- `pushChanges` is a single entry point that reads `pushStrategy` from the repo and handles both direct and PR mode inline (avoids circular type issues from `ctx.runAction` self-references)
- PR branches named `artie/{timestamp}` to avoid conflicts
- Commit messages auto-generated from AI explanation, truncated to 72 chars
- Merge conflict detection via "Update is not a fast forward" error with user-friendly message
- `fileChangesByMessageId` map built in ChatPanel to efficiently link messages to their file changes

### Verification

- `npx convex codegen` passes
- `npx tsc -p tsconfig.json --noEmit` passes (exit code 0)
- Next.js production build succeeds
- Browser test confirms pages render correctly (landing, login, signup, full app shell)

## Review (a973b3ef)

**Reviewed all 7 files modified. No issues found.**

Checks performed:
- `convex/github.ts` — `"use node"` directive present. `createCommitWithFiles` helper correctly uses Git Data API (getRef → getCommit → createBlob → createTree → createCommit → updateRef) for single multi-file commits. `commitToDefault` and `commitToBranch` actions properly separated. `pushChanges` orchestrator reads `pushStrategy` and delegates with explicit return type annotation. Branch naming `artie/${Date.now()}` avoids conflicts. Merge conflict detection via "Update is not a fast forward" error string. PR creation uses correct Octokit `pulls.create` API.
- `convex/messages.ts` — `get` query correctly uses two-arg `db.get`. `markChangesCommitted` preserves existing `changes` fields via spread.
- `convex/fileChanges.ts` — `get` query and `listBySession` query present and correct.
- `src/components/chat/MessageBubble.tsx` — "Approve & Push" button with loading/error states. Commit SHA badge (green), PR link (purple), committed status display. `fileChangeData` query with conditional skip. `ChangePreview` integration with diff view.
- `src/components/chat/MessageList.tsx` — `repoId` and `fileChangesByMessageId` props wired correctly.
- `src/components/chat/ChatPanel.tsx` — `listBySession` subscription builds `fileChangesByMessageId` map. All props passed through correctly.
- `src/components/layout/Sidebar.tsx` — Import path fix from `@/convex/` to relative path (correct for convex directory outside src/).
- `npm -s tsc -p tsconfig.json --noEmit` — passes
- `npm -s convex codegen` — passes
- No fixes needed
