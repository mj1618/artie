# Task: Add Feature Branch Association to Chat Sessions

## Context

The PLAN.md (Section 5, "Conversation Management") specifies: "Conversations are tied to features/branches to enable iterative development. Feature-based conversations: Each conversation is associated with a specific feature branch. Start new conversation: Users can start a new conversation for a new feature, which creates a new branch. Resume work: When starting a new conversation on an existing feature/branch, work continues where it left off."

Currently, sessions are simple — they have `repoId`, `userId`, `name`, and `firstMessage`, but no concept of feature branches. Users create a session and work in it, but every session always loads the repo's `defaultBranch`. There's no way to:
- Associate a session with a specific feature branch
- Start a new session that creates a feature branch
- Resume work on an existing feature branch in a new session
- Switch between branches in the workspace

### What exists now:
- `convex/schema.ts` — `sessions` table has `repoId`, `userId`, `name`, `firstMessage`, `previewCode`, timestamps. No branch fields.
- `convex/sessions.ts` — `createSession` mutation creates sessions. `listByRepo` query lists sessions.
- `src/app/workspace/[repoId]/page.tsx` — Workspace page with session management, chat, and preview.
- `src/components/layout/Header.tsx` — Shows `branchName` prop (currently always `repo.defaultBranch`).
- `convex/github.ts` — `commitToBranch` creates branches and PRs. `fetchRepoForWebContainer` loads files (branch param being added by another task).
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Boots WebContainer with repo files (branch option being added by another task).

### What's missing:
- Sessions table has no `branchName` or `featureName` fields
- No way to create a session tied to a new feature branch
- No way to resume a session on an existing branch
- The workspace always loads `defaultBranch` regardless of session
- No UI to start a "new feature" vs "continue on existing branch"

## Requirements

### 1. Add `branchName` and `featureName` fields to `sessions` table in `convex/schema.ts`

Add optional fields to the sessions table (optional so existing sessions continue to work):

```typescript
sessions: defineTable({
  repoId: v.id("repos"),
  userId: v.string(),
  createdAt: v.number(),
  lastActiveAt: v.number(),
  previewCode: v.optional(v.string()),
  firstMessage: v.optional(v.string()),
  name: v.optional(v.string()),
  // NEW: Feature branch association
  branchName: v.optional(v.string()),     // e.g., "feature/update-hero"
  featureName: v.optional(v.string()),    // e.g., "Update hero section"
})
```

### 2. Update `createSession` mutation in `convex/sessions.ts`

Accept optional `branchName` and `featureName` arguments:

```typescript
export const createSession = mutation({
  args: {
    repoId: v.id("repos"),
    branchName: v.optional(v.string()),
    featureName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // ... existing auth check ...
    return ctx.db.insert("sessions", {
      repoId: args.repoId,
      userId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      branchName: args.branchName,
      featureName: args.featureName,
    });
  },
});
```

### 3. Add "New Feature" session creation flow to the workspace page

In `src/app/workspace/[repoId]/page.tsx`, update the session creation UI:

When a user creates a new session, show a small form/dialog asking:
- **Feature name** (required): Human-readable name, e.g., "Update hero section"
- **Branch name** (auto-generated from feature name, editable): e.g., `feature/update-hero-section`

The auto-generation logic: lowercase, replace spaces with hyphens, prefix with `feature/`, remove special chars.

For now, the branch is NOT created on GitHub at session creation time — it's created when the user first pushes changes (the existing `commitToBranch` flow handles this). The `branchName` on the session is just a label indicating which branch the session's work will target.

### 4. Pass session's `branchName` to WebContainer loading

In the workspace page, when loading the WebContainer for a session that has a `branchName`:
- If the session has a `branchName`, pass it to `useWorkspaceContainer(repoId, { branch: session.branchName })`
- If no `branchName` (legacy sessions), use the default branch as before

**Note:** This depends on the "add branch loading for PR preview" task being completed. If that's not done yet, just pass the branch name through — the hook will use it once the branch loading support is added.

### 5. Show the session's branch name in the Header

Update the workspace page to pass `session.branchName ?? repo.defaultBranch` to the `Header` component's `branchName` prop. This way the header shows which branch the user is working on.

### 6. Show branch info in the session list

In the session list/sidebar within the workspace, show the feature name and branch name alongside each session so users can see which branch each session targets.

### 7. Run codegen and verify

- Run `npx convex dev --once` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `branchName` and `featureName` optional fields to `sessions` table |
| `convex/sessions.ts` | **Modify** | Update `createSession` to accept and store `branchName` and `featureName` |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Add "new feature" creation flow with feature name + branch name inputs; pass `session.branchName` to `useWorkspaceContainer` and `Header` |

## Acceptance Criteria

1. Sessions table schema includes optional `branchName` and `featureName` fields
2. `createSession` mutation accepts and stores `branchName` and `featureName`
3. Creating a new session in the workspace prompts for a feature name
4. A branch name is auto-generated from the feature name (with `feature/` prefix)
5. The branch name is editable before creating the session
6. The session's branch name is passed to the `Header` component and displayed
7. The session's branch name is passed to `useWorkspaceContainer` (for when branch loading is available)
8. Existing sessions without branch fields continue to work (loads default branch)
9. The session list shows feature name and branch for each session
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The `branchName` and `featureName` fields are optional to maintain backward compatibility with existing sessions
- Branch creation on GitHub happens at push time (existing `commitToBranch` flow), NOT at session creation time — the session just tracks which branch name to use
- Auto-generated branch name format: `feature/{kebab-case-feature-name}` — e.g., "Update Hero Section" → `feature/update-hero-section`
- If a session has a `branchName` and the branch already exists on GitHub, `useWorkspaceContainer` will load that branch's files (once branch loading support is added)
- If the branch doesn't exist yet on GitHub (user hasn't pushed), it falls back to `defaultBranch` — this is fine because the changes are in the WebContainer locally
- The `commitToBranch` action already creates branches, so the push flow doesn't need changes — it just needs to use the session's `branchName` instead of generating one in the push dialog
- When the user pushes from a branch-associated session, pre-fill the push dialog's branch name with the session's `branchName`

## Completion Summary

### What was built
Feature branch association for chat sessions. Users can now create sessions tied to feature branches, with auto-generated branch names from feature names.

### Files changed

| File | Changes |
|------|---------|
| `convex/schema.ts` | Added optional `branchName` and `featureName` fields to `sessions` table |
| `convex/sessions.ts` | Updated `create` mutation to accept `branchName` and `featureName` args |
| `src/app/workspace/[repoId]/page.tsx` | Added `NewFeatureDialog` component with feature name input, auto-generated branch name, and editable branch field. Wired session creation flow, passes branch name to Header and PreviewPanel |
| `src/components/chat/ChatPanel.tsx` | Added `onNewChatRequest` and `pendingBranchInfo` props, passes branch info to `createSession` |
| `src/components/chat/SessionPicker.tsx` | Shows `featureName` as primary label and `branchName` in blue monospace under each session |
| `src/components/preview/PreviewPanel.tsx` | Added `branch` prop, passes it to `useWorkspaceContainer` |

### Browser-verified behavior
- "New Chat" opens a "New Feature" dialog with feature name and branch name fields
- Branch name auto-generates from feature name (e.g., "Add dark mode toggle" → "feature/add-dark-mode-toggle")
- Branch name is editable
- Created session shows feature branch name in Header instead of default branch
- Session list shows feature name and branch name for feature sessions
- Legacy sessions without branch fields continue working (show default branch)

## Review (7d8bb513)

### Files Reviewed
- `convex/schema.ts` — `branchName: v.optional(v.string())` and `featureName: v.optional(v.string())` on sessions table
- `convex/sessions.ts` — `create` mutation accepts optional `branchName` and `featureName` args
- `src/app/workspace/[repoId]/page.tsx` — `NewFeatureDialog` component, `generateBranchName` helper, session creation flow, branch name passed to Header and PreviewPanel
- `src/components/chat/ChatPanel.tsx` — `onNewChatRequest` and `pendingBranchInfo` props, branch info threaded to `createSession`
- `src/components/chat/SessionPicker.tsx` — Shows `featureName` as primary label, `branchName` in blue monospace
- `src/components/preview/PreviewPanel.tsx` — `branch` prop passed to `useWorkspaceContainer`

### No Issues Found
- `"use client"` directive present on all client components
- Schema fields are correctly optional for backward compatibility
- `generateBranchName` produces valid git branch names (lowercase, no special chars, `feature/` prefix)
- `NewFeatureDialog` correctly resets state on open, validates both fields before enabling create
- `activeBranchName` fallback chain `activeSession?.branchName ?? repo?.defaultBranch` is correct
- `pendingBranchInfo` correctly passed to `ChatPanel` and used in `createSession` call
- `SessionPicker` uses `featureName ?? getSessionLabel(session)` for display — correct priority
- `PreviewPanel` passes `branch` to `useWorkspaceContainer` options — consistent with hook signature
- `npx tsc --noEmit` passes cleanly
