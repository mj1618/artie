# Task: Add Template Selection UI to Dashboard

## Context

Phase 6 includes the ability to create applications from templates. The backend CRUD for template projects (`convex/templates.ts`) and Fly.io deploy key management (`convex/deployKeys.ts`) are now built. The dashboard home page (`src/app/(dashboard)/home/page.tsx`) shows teams with their connected GitHub repos and recent sessions, but has no way to create template projects.

This task adds a "Create from Template" flow to the dashboard, including:
- A "Create from Template" button in each team's card
- A creation dialog/modal to collect project name, slug, and Fly.io deploy key selection
- Display of existing template projects alongside GitHub repos in each team card

### What exists now:
- `convex/templates.ts` — `listByTeam`, `get`, `create`, `updateStatus`, `remove`, `checkSlugAvailable` functions
- `convex/deployKeys.ts` — `listByTeam`, `addDeployKey`, `deleteDeployKey` functions
- `src/app/(dashboard)/home/page.tsx` — Dashboard with teams, repos, recent sessions, onboarding
- Teams are displayed as cards with a "Manage" link and a `<TeamRepos>` component showing connected repos

### What's missing:
- "Create from Template" button in each team card header (next to the "Manage" link)
- A modal/dialog for template creation with fields: project name, slug (auto-generated from name), template selector (only "Next.js + Convex" for now), Fly.io deploy key selector
- Template projects displayed in each team card (alongside or below the GitHub repos)
- Slug availability checking (using `templates.checkSlugAvailable`)

## Requirements

### 1. Add `TemplateProjects` component to display existing template projects

Create a component similar to `TeamRepos` that queries `api.templates.listByTeam` and displays template projects:

```tsx
function TemplateProjects({ teamId }: { teamId: Id<"teams"> }) {
  const projects = useQuery(api.templates.listByTeam, { teamId });

  if (projects === undefined) {
    return <div className="divide-y divide-zinc-800"><ListItemSkeleton /></div>;
  }
  if (projects.length === 0) return null;

  return (
    <ul className="divide-y divide-zinc-800">
      {projects.map((project) => (
        <li key={project._id} className="flex items-center px-4 py-3 transition-colors hover:bg-zinc-800/50">
          {/* Template icon */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-200">{project.name}</p>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Next.js + Convex</span>
              <span>·</span>
              <span className={
                project.status === "active" ? "text-green-400" :
                project.status === "provisioning" ? "text-yellow-400" :
                "text-red-400"
              }>
                {project.status}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

### 2. Add "Create from Template" dialog

Add a modal dialog for creating a template project. This should be triggered by a "Create from Template" button in the team card header:

**Dialog fields:**
- **Project Name** (text input) — required, used for display
- **Slug** (text input) — auto-generated from project name (lowercase, hyphens), editable. Show real-time availability check using `api.templates.checkSlugAvailable`
- **Template** (read-only for now) — "Next.js + Convex" (only option)
- **Fly.io Deploy Key** (select dropdown) — lists keys from `api.deployKeys.listByTeam`. If no keys exist, show a message linking to the deploy keys settings page.

**Dialog actions:**
- "Create Project" button — calls `api.templates.create` with the selected values
- "Cancel" button

**State management:**
```tsx
const [showTemplateDialog, setShowTemplateDialog] = useState(false);
const [templateTeamId, setTemplateTeamId] = useState<Id<"teams"> | null>(null);
const [projectName, setProjectName] = useState("");
const [projectSlug, setProjectSlug] = useState("");
const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
const [selectedDeployKeyId, setSelectedDeployKeyId] = useState<Id<"flyioDeployKeys"> | null>(null);
const [creatingProject, setCreatingProject] = useState(false);
```

**Slug auto-generation:**
```tsx
function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
```

When the user types in the project name and hasn't manually edited the slug, auto-update the slug from the name.

### 3. Add button to each team card

In the team card header (where "Manage" link is), add a "Create from Template" button:

```tsx
<div className="flex items-center gap-2">
  <button
    onClick={() => {
      setTemplateTeamId(team._id);
      setShowTemplateDialog(true);
    }}
    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
  >
    + Template
  </button>
  <Link href={`/team/${team._id}`} className="...">
    Manage
  </Link>
</div>
```

### 4. Show template projects in team cards

Below `<TeamRepos teamId={team._id} />`, add `<TemplateProjects teamId={team._id} />` to show template projects in each team card.

### 5. Verify

- Run `npx convex dev --once` to regenerate types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add `TemplateProjects` component, "Create from Template" button in team cards, template creation dialog, display template projects in team cards |

## Acceptance Criteria

1. Each team card has a "+ Template" button in the header
2. Clicking the button opens a creation dialog with project name, slug, and deploy key fields
3. Slug is auto-generated from the project name (but can be manually edited)
4. Deploy key dropdown lists available keys from `api.deployKeys.listByTeam`
5. If no deploy keys exist, the dialog shows a message linking to deploy key settings
6. "Create Project" calls `api.templates.create` with the correct arguments
7. Template projects are displayed in each team card (below GitHub repos)
8. Template projects show name, template type, and status (with color-coded status badge)
9. Toast notifications for success/error on project creation
10. `npx convex dev --once` succeeds
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The template creation dialog should be a simple modal overlay (use the same dark zinc styling as the rest of the app). Don't import a dialog library — use a simple div overlay pattern.
- Only "Next.js + Convex" template is available. Show it as the default/only option, no need for a complex selector.
- The `api.templates.create` mutation requires `flyioDeployKeyId: v.id("flyioDeployKeys")`, so the deploy key selector is mandatory.
- Slug availability is checked via `api.templates.checkSlugAvailable` — use this reactively (query with the current slug value). Show a green check or red X next to the slug field.
- After successful creation, close the dialog and reset form state. The project will appear in the team card via the reactive `listByTeam` query.
- Template projects created in "provisioning" state — actual provisioning is a future task. For now, just display the status.
- Follow existing patterns in the home page (useToast, useMutation, useState).

## Completion Summary

### Files Modified
| File | Changes |
|------|---------|
| `src/app/(dashboard)/home/page.tsx` | Added `TemplateProjects` component, `CreateTemplateDialog` component, `nameToSlug` helper, `+ Template` button in team card headers, `templateTeamId` state |

### What Was Built
- **`TemplateProjects` component**: Queries `api.templates.listByTeam` and displays template projects with a purple stack icon, name, template type ("Next.js + Convex"), and color-coded status badge (green=active, yellow=provisioning, red=error). Returns null if no projects exist.
- **`CreateTemplateDialog` component**: Modal overlay dialog with fields for Project Name, Slug (auto-generated from name via `nameToSlug`), Template (read-only "Next.js + Convex"), and Fly.io Deploy Key selector. Includes real-time slug availability checking via `api.templates.checkSlugAvailable` with green checkmark / red X. Shows "Add one first" link to deploy key settings if no keys exist. Calls `api.templates.create` on submit with success/error toasts.
- **"+ Template" button**: Added to each team card header next to "Manage" link. Opens the creation dialog scoped to that team.
- **Template project listing**: `<TemplateProjects>` rendered below `<TeamRepos>` in each team card.

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed (no errors)
- Browser tested: dashboard loads, "+ Template" button visible in team cards, clicking opens dialog, project name auto-generates slug, slug availability check shows green checkmark, deploy key selector shows "No deploy keys" with link when none exist, Cancel button closes dialog
