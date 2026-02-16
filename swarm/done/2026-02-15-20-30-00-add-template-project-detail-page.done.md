# Task: Add Template Project Detail Page

## Context

Phase 6 includes template project management (view, delete). The backend CRUD is built (`convex/templates.ts` has `get` and `remove`), and the dashboard home page lists template projects in each team card. However, template project items in the list are **not clickable** — there is no detail page where users can view project details or delete a project.

This task adds a detail page at `/team/[teamId]/templates/[projectId]` and makes the template project list items on the dashboard clickable.

### What exists now:
- `convex/templates.ts` — `get` (query, auth-gated), `remove` (mutation, owner-only)
- `src/app/(dashboard)/home/page.tsx` — `TemplateProjects` component showing template projects in each team card (name, template type, status badge). Items are NOT clickable.
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Repo detail/settings page (good pattern to follow)
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Team management page (breadcrumb/layout pattern)
- `convex/schema.ts` — `templateProjects` table with fields: `teamId`, `name`, `slug`, `template`, `createdBy`, `createdAt`, `convexProjectId`, `convexDeploymentUrl`, `convexDeployKey`, `flyioAppName`, `flyioDeployKey`, `status`, `errorMessage`
- `ConfirmDialog` component for destructive action confirmation
- Toast notification system (`useToast`)

### What's missing:
- A detail page at `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx`
- Template project list items on the dashboard should link to this detail page
- Ability for owners to delete a template project from the detail page

## Requirements

### 1. Create template project detail page

Create `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx` with:

**Header:**
- Back link: `← Back to Team` (links to `/team/[teamId]`)
- Page title: project name
- Status badge (color-coded: green for active, yellow for provisioning, red for error)

**Project Information section (read-only card):**
- **Name** — project display name
- **Slug** — the Convex project slug
- **Template** — "Next.js + Convex"
- **Created** — formatted date from `createdAt`
- **Status** — provisioning / active / error with color

**Deployment Details section (only shown when project has provisioning data):**
- **Convex Project ID** — `convexProjectId` (or "Pending..." if empty)
- **Convex Deployment URL** — `convexDeploymentUrl` (clickable link if populated)
- **Fly.io App Name** — `flyioAppName`

**Error section (only shown when status is "error"):**
- Show `errorMessage` in a red-bordered card

**Danger Zone (owner-only):**
- "Delete Project" button with ConfirmDialog
- On confirm, calls `api.templates.remove({ projectId })`
- After deletion, redirect to `/team/[teamId]`

**Non-owner view:**
- Hide the Danger Zone section
- Show all information as read-only

### 2. Page structure

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useState } from "react";

export default function TemplateProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const teamId = params.teamId as Id<"teams">;
  const projectId = params.projectId as Id<"templateProjects">;

  const project = useQuery(api.templates.get, { projectId });
  const team = useQuery(api.teams.get, { teamId });
  // Need current user to check ownership
  const me = useQuery(api.users.me);
  const removeProject = useMutation(api.templates.remove);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Loading state
  if (project === undefined || team === undefined || me === undefined) {
    return /* loading skeleton */;
  }

  // Not found
  if (!project || !team) {
    return /* not found message */;
  }

  const isOwner = team.ownerId === me?._id;

  // ... render page
}
```

### 3. Make template project list items clickable on dashboard

In `src/app/(dashboard)/home/page.tsx`, update the `TemplateProjects` component to wrap each list item with a `Link` to `/team/${project.teamId}/templates/${project._id}`.

The list item `<li>` should become (or be wrapped by) a Next.js `<Link>`:

```tsx
<Link
  href={`/team/${project.teamId}/templates/${project._id}`}
  className="flex items-center px-4 py-3 transition-colors hover:bg-zinc-800/50"
>
  {/* existing content */}
</Link>
```

### 4. Verify

- Run `npm -s convex codegen` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx` | **Create** | Template project detail page with project info, deployment details, error display, and owner-only delete |
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Make template project list items clickable with links to the detail page |

## Acceptance Criteria

1. `/team/[teamId]/templates/[projectId]` renders a detail page for the template project
2. Page shows project name, slug, template type, creation date, and status
3. Status is color-coded (green=active, yellow=provisioning, red=error)
4. Deployment details (Convex project ID, deployment URL, Fly.io app name) are shown when available
5. Error message is shown in a red card when status is "error"
6. Owners see a "Delete Project" button in a danger zone section
7. Delete triggers a ConfirmDialog, and on confirm calls `api.templates.remove`
8. After successful deletion, user is redirected to `/team/[teamId]`
9. Non-owners see all info as read-only with no danger zone
10. Template projects on the dashboard home page are clickable and link to the detail page
11. Loading and not-found states are handled gracefully
12. `npm -s convex codegen` succeeds
13. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Follow the same dark zinc styling pattern used on the repo settings page (`zinc-900` bg, `zinc-800` borders, `zinc-100`/`zinc-400` text)
- Use `useParams()` to extract `teamId` and `projectId` from the URL
- The `api.templates.get` query handles auth gating — if the user isn't a team member, it returns `null`
- The `api.teams.get` query is needed to check if current user is the owner (for showing danger zone)
- Use the `api.users.me` query to get the current user's ID
- `ConfirmDialog` props: `open`, `onClose`, `onConfirm`, `title`, `description`, `confirmLabel`, `variant` ("danger"), `loading`
- After deletion, use `router.push(/team/${teamId})` to redirect
- For the dashboard link update: the `TemplateProjects` component receives `teamId` as a prop but each project also has `teamId` in its data — use `project.teamId` for the link
- Format `createdAt` timestamp with `new Date(createdAt).toLocaleDateString()` for a clean date display
- If `convexDeploymentUrl` is populated and non-empty, render it as a clickable `<a>` link with `target="_blank"` and `rel="noopener noreferrer"`

## Completion Summary

### Files Created
- `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx` — Template project detail page with:
  - StatusBadge component (color-coded: green/active, yellow/provisioning, red/error)
  - Header with back link and project name + status badge
  - Project Information section (name, slug, template, created date, status)
  - Deployment Details section (Convex Project ID, Convex Deployment URL as clickable link, Fly.io App Name) — conditionally shown
  - Error section with red-bordered card — shown when status is "error"
  - Danger Zone with Delete button + ConfirmDialog — owner-only
  - Loading spinner and not-found states
  - Uses `api.teams.getTeam`, `api.users.currentUser`, `api.templates.get`, `api.templates.remove`

### Files Modified
- `src/app/(dashboard)/home/page.tsx` — Wrapped template project list items in `<Link>` components pointing to `/team/${project.teamId}/templates/${project._id}`

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed, no errors
- Browser testing: dashboard loads correctly, template detail page route resolves and renders within the dashboard layout

## Review (Reviewer Agent 5d673309)

**Reviewed files:**
- `src/app/(dashboard)/team/[teamId]/templates/[projectId]/page.tsx` (created)
- `src/app/(dashboard)/home/page.tsx` (modified)

**Checks performed:**
- Verified `"use client"` directive present
- Verified all API function names match backend (`api.templates.get`, `api.teams.getTeam`, `api.users.currentUser`, `api.templates.remove`)
- Verified `StatusBadge` type union matches schema definition (`"provisioning" | "active" | "error"`)
- Verified `team.ownerId` field exists in schema and is returned by `getTeam` query
- Verified `ConfirmDialog` props match component interface (open, onClose, onConfirm, title, description, confirmLabel, variant, loading)
- Verified `useToast` import path and usage (`{ toast }` destructuring) are correct
- Verified loading and not-found states are handled
- Verified convex import paths use relative paths (consistent with project — `@/` only maps to `./src/*`, not project root where `convex/` lives)
- Re-ran `npx tsc -p tsconfig.json --noEmit` — passed with no errors
- Re-ran `npx convex codegen` — passed

**Issues found:** None. Code is clean and correct.
**Fixes applied:** None needed.
