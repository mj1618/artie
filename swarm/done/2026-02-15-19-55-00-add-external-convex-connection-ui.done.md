# Task: Add External Convex Connection UI to Repo Settings

## Context

Phase 6 includes the ability to connect an existing external Convex application to a repository. The `repos` table already has `externalConvexUrl` and `externalConvexDeployment` optional fields (added in the schema task), but there is:
- No backend mutation support for updating these fields
- No UI for owners to enter/view/clear external Convex connection details
- No validation or display of the connection status

This task adds an "External Convex" section to the repo settings page and extends the `updateRepo` mutation to handle the new fields. Per the PLAN, external Convex connections **require** the repo to use Fly.io runtime (not WebContainers).

### What exists now:
- `convex/schema.ts` — `repos` table has `externalConvexUrl: v.optional(v.string())` and `externalConvexDeployment: v.optional(v.string())` fields
- `convex/projects.ts` — `updateRepo` mutation handles `pushStrategy`, `defaultBranch`, `runtime` but NOT the external Convex fields
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Settings page with push strategy, runtime selection, default branch, and danger zone

### What's missing:
- `updateRepo` mutation needs to accept `externalConvexUrl` and `externalConvexDeployment` optional args
- Repo settings page needs an "External Convex" section (between Configuration and Danger Zone) where owners can:
  - Enter a Convex deployment URL (e.g., `https://your-project-123.convex.cloud`)
  - Enter a Convex deployment name (e.g., `your-project-123`)
  - Save the connection
  - Clear the connection (set both fields to undefined)
- A note/warning that external Convex requires Fly.io runtime

## Requirements

### 1. Extend `updateRepo` mutation in `convex/projects.ts`

Add the two new optional args and include them in the update logic:

```typescript
// Add to args:
externalConvexUrl: v.optional(v.string()),
externalConvexDeployment: v.optional(v.string()),

// Add to the updates type:
externalConvexUrl: string;
externalConvexDeployment: string;

// Add to the update logic:
if (args.externalConvexUrl !== undefined) updates.externalConvexUrl = args.externalConvexUrl;
if (args.externalConvexDeployment !== undefined) updates.externalConvexDeployment = args.externalConvexDeployment;
```

Also add a `clearExternalConvex` flag arg (v.optional(v.boolean())) to allow clearing the fields. When `clearExternalConvex` is true, patch the repo with `externalConvexUrl: undefined` and `externalConvexDeployment: undefined`.

### 2. Add "External Convex" section to repo settings page

Add a new section between the Configuration form and the Danger Zone. This section should:

**When no external Convex is connected:**
- Show a card with title "External Convex Application"
- Description: "Connect an existing Convex deployment to enable full-stack development with a persistent backend."
- Two input fields: "Deployment URL" (text, placeholder: `https://your-project.convex.cloud`) and "Deployment Name" (text, placeholder: `your-project-123`)
- A "Connect" button to save the values via `updateRepo`
- A small note: "Requires Fly.io runtime. WebContainer runtime does not support external Convex connections."
- If the repo's current runtime is `webcontainer`, show a warning that they need to switch to Fly.io first, and disable the Connect button.

**When external Convex is already connected:**
- Show the connected deployment URL and name in a read-only display
- A "Disconnect" button (with confirmation) that clears both fields

### 3. State management

Add local state for the external Convex fields:

```typescript
const [externalConvexUrl, setExternalConvexUrl] = useState("");
const [externalConvexDeployment, setExternalConvexDeployment] = useState("");
const [connectingConvex, setConnectingConvex] = useState(false);
```

This section has its own save flow (separate from the Configuration form's Save button) since connecting/disconnecting Convex is a distinct action.

### 4. Verify

- Run `npx convex dev --once` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/projects.ts` | **Modify** | Add `externalConvexUrl`, `externalConvexDeployment`, and `clearExternalConvex` args to `updateRepo` mutation |
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | **Modify** | Add "External Convex Application" section with connect/disconnect UI |

## Acceptance Criteria

1. `updateRepo` mutation accepts `externalConvexUrl` and `externalConvexDeployment` optional string args
2. `updateRepo` mutation accepts `clearExternalConvex` boolean flag to remove the connection
3. Repo settings page shows an "External Convex Application" section (owner-only)
4. Owners can enter a deployment URL and name and click "Connect" to save
5. When connected, the section shows the current connection with a "Disconnect" button
6. Disconnecting clears both fields (with confirmation dialog)
7. If runtime is WebContainer, the Connect button is disabled with a warning message
8. Toast notifications for success/error
9. `npx convex dev --once` succeeds
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The external Convex section has its own save/connect action, separate from the main Configuration form's Save button. This keeps the UX clear: connecting Convex is a deliberate action.
- The `clearExternalConvex` flag is needed because Convex `db.patch` doesn't support setting fields to `undefined` directly — you need to explicitly handle clearing. If Convex does support patching with `undefined`, you can skip the flag and just pass `undefined` values directly.
- No actual Convex API calls are made in this task — we're just storing the user-provided deployment URL/name. Validation against the Convex API is a separate future task.
- Follow the same visual patterns as the rest of the settings page (zinc-800 borders, zinc-900 bg, zinc-100 text).
- Only owners should see the External Convex section (same as other settings).

## Completion Summary

### Files Modified

1. **`convex/projects.ts`** — Extended `updateRepo` mutation with three new optional args: `externalConvexUrl` (string), `externalConvexDeployment` (string), and `clearExternalConvex` (boolean). When `clearExternalConvex` is true, both fields are patched to `undefined`. Otherwise, the fields are included in the standard update flow.

2. **`src/app/(dashboard)/repos/[repoId]/settings/page.tsx`** — Added "External Convex Application" section between Configuration and Danger Zone:
   - **Disconnected state**: Shows two input fields (Deployment URL, Deployment Name) with a Connect button. When runtime is WebContainer, shows a warning banner and disables the Connect button.
   - **Connected state**: Shows read-only display of the deployment URL and name with a Disconnect button that triggers a ConfirmDialog.
   - State management: Added `externalConvexUrl`, `externalConvexDeployment`, `connectingConvex`, `showDisconnectConvex`, `disconnectingConvex` state variables.
   - Added `handleConnectConvex` and `handleDisconnectConvex` handlers with toast notifications.
   - Added a second `ConfirmDialog` for the Convex disconnect confirmation.

### Verification
- `npx -s convex codegen` — passed
- `npx -s tsc -p tsconfig.json --noEmit` — passed (zero errors)
- Browser testing confirmed the section renders correctly on repo settings pages with proper warning/disabled states for WebContainer runtime

## Review (Reviewer 4d13e251)

Reviewed both modified files (`convex/projects.ts`, `src/app/(dashboard)/repos/[repoId]/settings/page.tsx`) plus schema, ConfirmDialog, and useToast dependencies. No issues found:

- `"use client"` directive present
- All imports resolve correctly; relative convex imports match codebase convention
- Loading/null states handled properly
- Owner-only guard on External Convex section
- Connect button correctly disabled when runtime is `webcontainer` or fields are empty
- Disconnect uses ConfirmDialog with loading state
- Toast notifications for success/error on both connect and disconnect
- ConfirmDialog props match interface exactly
- Schema fields match mutation args (`v.optional(v.string())`)
- `npx tsc --noEmit` passes with zero errors

No fixes needed.
