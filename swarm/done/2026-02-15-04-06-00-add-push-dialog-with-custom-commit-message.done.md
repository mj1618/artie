# Task: Add Push Dialog with Custom Commit Message and PR Details

## Context

When a user clicks "Approve & Push to GitHub" on a message with file changes, the current flow immediately calls `pushChanges` with an auto-generated commit message (first line of the AI message) and, for PR mode, auto-generated branch name (`artie/{timestamp}`), PR title, and PR body. The user gets zero input on any of these.

This is a significant UX gap:
- Non-technical users may not understand what was committed on their behalf
- Technical users will want to customize commit messages
- PR titles like "Artie: I updated the button color to red..." read poorly on GitHub
- Auto-generated branch names like `artie/1739584200000` are not meaningful

The PLAN.md specifies: "User can approve or reject changes" — approval should include reviewing what will be committed and having the chance to customize the commit description.

### What exists now:
- `src/components/chat/MessageBubble.tsx` — Has "Approve & Push to GitHub" button that directly calls `pushChanges` action with no dialog
- `convex/github.ts` — `pushChanges` action auto-generates commit message from `message.content.split("\n")[0]`. For PR mode, auto-generates branch name, PR title, and PR body
- `convex/github.ts` — `commitToDefault` and `commitToBranch` actions already accept `commitMessage`, `branchName`, `prTitle`, `prBody` as args
- `src/components/ui/ConfirmDialog.tsx` — Existing confirmation dialog component (but it's a simple yes/no, not a form)
- `src/components/chat/ChangePreview.tsx` — Shows file changes with diff view

### What's missing:
- No dialog/modal before pushing that shows what will be committed
- No ability to edit the commit message
- No ability to edit the PR title or PR body (for PR mode)
- No preview of branch name (for PR mode)

## Requirements

### 1. Create `src/components/chat/PushDialog.tsx`

A modal dialog that appears when the user clicks "Approve & Push to GitHub". It should show:

**For both modes (direct and PR):**
- A text input for the commit message, pre-filled with a sensible default derived from the AI message (first meaningful line, max 72 chars)
- A list of files that will be committed (read-only)
- "Push" and "Cancel" buttons

**For PR mode additionally:**
- A text input for branch name, pre-filled with `artie/{short-description}` (derived from commit message, slugified)
- A text input for PR title, pre-filled with the commit message
- A textarea for PR body, pre-filled with a summary of changes and list of files

The dialog should:
- Fetch the repo info to determine push strategy (direct vs PR) using the existing `api.projects.get` query
- Show the appropriate fields based on the push strategy
- Disable the "Push" button while pushing
- Show errors inline if the push fails
- Close on successful push (the MessageBubble will update reactively to show the committed state)

```tsx
interface PushDialogProps {
  repoId: Id<"repos">;
  messageId: Id<"messages">;
  fileChangeId: Id<"fileChanges">;
  files: string[];
  messageContent: string;
  onClose: () => void;
}
```

### 2. Update `MessageBubble.tsx` to show the PushDialog

Replace the direct `pushChanges` call with opening the `PushDialog`:

```tsx
// Before:
const handlePush = async () => {
  await pushChanges({ repoId, messageId, fileChangeId });
};

// After:
const [showPushDialog, setShowPushDialog] = useState(false);
// ...
{showPushDialog && (
  <PushDialog
    repoId={repoId}
    messageId={messageId}
    fileChangeId={fileChangeId}
    files={changes.files}
    messageContent={content}
    onClose={() => setShowPushDialog(false)}
  />
)}
```

The button text stays "Approve & Push to GitHub" but now it opens the dialog instead of pushing immediately.

### 3. Update `convex/github.ts` `pushChanges` to accept optional custom fields

Add optional args for `commitMessage`, `branchName`, `prTitle`, `prBody` to the `pushChanges` action. When provided, use them instead of auto-generating:

```typescript
export const pushChanges = action({
  args: {
    repoId: v.id("repos"),
    messageId: v.id("messages"),
    fileChangeId: v.id("fileChanges"),
    commitMessage: v.optional(v.string()),
    branchName: v.optional(v.string()),
    prTitle: v.optional(v.string()),
    prBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Use args.commitMessage ?? auto-generated default
    // Use args.branchName ?? `artie/${Date.now()}`
    // Use args.prTitle ?? commitMessage
    // Use args.prBody ?? auto-generated
  },
});
```

### 4. Run codegen and verify

- Run `npm -s convex codegen` to regenerate API types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/PushDialog.tsx` | **Create** | Modal dialog for customizing commit message, PR title/body, and branch name before pushing |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Replace direct `pushChanges` call with opening `PushDialog`; remove inline push state |
| `convex/github.ts` | **Modify** | Add optional `commitMessage`, `branchName`, `prTitle`, `prBody` args to `pushChanges` action |

## Acceptance Criteria

1. Clicking "Approve & Push to GitHub" opens a modal dialog instead of immediately pushing
2. The dialog shows a commit message field pre-filled with a sensible default
3. The dialog shows the list of files that will be committed
4. For repos with `pushStrategy: "pr"`, the dialog also shows editable branch name, PR title, and PR body fields
5. For repos with `pushStrategy: "direct"`, only the commit message and file list are shown
6. The user can edit all text fields before pushing
7. Clicking "Push" in the dialog performs the push with the customized values
8. The dialog shows a loading state while pushing and errors on failure
9. On successful push, the dialog closes and the message shows the committed/PR state
10. Clicking "Cancel" closes the dialog without pushing
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useQuery(api.projects.get, { repoId })` inside the dialog to get the repo's `pushStrategy`
- The dialog should be a portal (rendered at the document root) to avoid z-index issues inside the chat scroll area — use React's `createPortal` or just position it fixed
- Pre-fill the branch name by slugifying the commit message: lowercase, replace spaces/special chars with hyphens, truncate to 40 chars, prefix with `artie/`
- The commit message default should be the first non-empty line of the AI message content, truncated to 72 chars (git convention)
- Strip any markdown formatting from the default commit message (e.g., remove `#`, `**`, etc.)
- The PR body default should include the full AI message content (or a relevant excerpt) plus the list of changed files in markdown format
- The `pushChanges` action args are all optional — backward compatible with existing callers (though after this task, the only caller is `PushDialog`)
