# Task: Add New User Onboarding Flow

## Context

The PLAN.md (Phase 1) specifies: "Owner onboarding flow: 1. Create account, 2. Connect GitHub (OAuth to get access token), 3. Select repositories to enable, 4. Configure push strategy per repo." Currently, after signup, users land on a blank dashboard with "You don't have any teams yet" and a "Create your first team" button. There's no guided flow to help them through the critical setup steps.

For a non-technical user (Artie's target audience), this is confusing. They create a team, then see "No repos connected yet" with no clear next step. They'd need to somehow discover they should:
1. Go to Settings to connect GitHub
2. Come back to the team page to browse and connect repos
3. Then navigate to a workspace

### What exists now:
- `src/app/(dashboard)/home/page.tsx` — Dashboard home showing teams and repos. Shows "Create your first team" when no teams exist.
- `src/app/(dashboard)/settings/page.tsx` — Has `GitHubConnection` component for connecting GitHub (OAuth flow)
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Has `AddRepoSection` with GitHub repo browser (when GitHub is connected) and manual entry fallback
- `convex/teams.ts` — `createTeam` mutation
- `convex/users.ts` — `getProfile` query (returns `githubUsername`, `githubAccessToken`)
- `convex/projects.ts` — `listByTeam` query, `addRepo` mutation

### What's missing:
- No step-by-step onboarding guide for new users
- No visual indicator of what steps are incomplete
- No way to know you need to connect GitHub before browsing repos
- The critical setup path is spread across 3 different pages with no connecting thread

## Requirements

### 1. Add `OnboardingChecklist` component to `src/app/(dashboard)/home/page.tsx`

Display a checklist card at the top of the dashboard (above teams) for users who haven't completed setup. The checklist shows progress through the setup steps:

**Steps:**
1. **Create a team** — Check: user has at least one team (`teams.length > 0`)
2. **Connect GitHub** — Check: profile has `githubUsername` set
3. **Connect a repository** — Check: any team has at least one repo

The checklist should:
- Show a progress bar (e.g., "1 of 3 complete")
- Each step has a status icon (checkmark if done, circle if next, dim if future)
- The "next" step has an action button:
  - "Create a team" → opens the inline create team form (same as existing)
  - "Connect GitHub" → links to `/settings` (where the OAuth button is)
  - "Connect a repository" → links to `/team/{teamId}` (where the repo browser is)
- Auto-dismiss: once all 3 steps are done, the checklist collapses with a "Setup complete!" message and a dismiss button
- Store dismissal in localStorage so it doesn't reappear

```tsx
function OnboardingChecklist({
  teams,
  profile,
  hasRepos,
  onCreateTeam,
}: {
  teams: Array<{ _id: Id<"teams">; name: string }>;
  profile: { githubUsername?: string } | null;
  hasRepos: boolean;
  onCreateTeam: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("artie_onboarding_dismissed") === "true";
  });

  if (dismissed) return null;

  const steps = [
    {
      label: "Create a team",
      done: teams.length > 0,
      action: onCreateTeam,
      actionLabel: "Create Team",
    },
    {
      label: "Connect your GitHub account",
      done: !!profile?.githubUsername,
      href: "/settings",
      actionLabel: "Connect GitHub",
    },
    {
      label: "Connect a repository",
      done: hasRepos,
      href: teams.length > 0 ? `/team/${teams[0]._id}` : undefined,
      actionLabel: "Browse Repos",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  // ... render checklist card
}
```

### 2. Add a query to check if the user has any repos across all teams

Create a simple helper (either a new query in `convex/projects.ts` or compute it client-side) to determine if the user has any connected repos. Client-side is simplest — iterate the teams array and check if any has repos. But since `TeamRepos` already queries per-team, we can add a combined query:

```typescript
// In convex/projects.ts — add:
export const hasAnyRepos = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    // Get all teams the user is on
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const m of memberships) {
      const repos = await ctx.db
        .query("repos")
        .withIndex("by_teamId", (q) => q.eq("teamId", m.teamId))
        .first();
      if (repos) return true;
    }
    return false;
  },
});
```

### 3. Integrate into the dashboard page

In `DashboardPage`, add the checklist above the teams section:

```tsx
export default function DashboardPage() {
  const teams = useQuery(api.teams.listMyTeams);
  const profile = useQuery(api.users.getProfile);
  const hasRepos = useQuery(api.projects.hasAnyRepos);
  // ... existing state ...

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Title */}
      <h1>...</h1>

      {/* Onboarding Checklist — shown for new users */}
      {teams !== undefined && profile !== undefined && hasRepos !== undefined && (
        <OnboardingChecklist
          teams={teams}
          profile={profile}
          hasRepos={hasRepos}
          onCreateTeam={() => setShowCreate(true)}
        />
      )}

      {/* Pending Invites */}
      <PendingInvites />

      {/* Teams section (existing) */}
      ...
    </div>
  );
}
```

### 4. Run codegen and verify

- Run `npx convex dev --once` to regenerate API types
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/home/page.tsx` | **Modify** | Add `OnboardingChecklist` component; add `profile` and `hasRepos` queries; render checklist above teams |
| `convex/projects.ts` | **Modify** | Add `hasAnyRepos` query that checks if the user has any repos across all their teams |

## Acceptance Criteria

1. New users see a step-by-step onboarding checklist at the top of the dashboard after signup
2. The checklist shows 3 steps: Create a team, Connect GitHub, Connect a repository
3. Each step shows a done/pending status with a checkmark or circle icon
4. A progress indicator shows "X of 3 complete"
5. The current "next" step has a clickable action button that navigates to the right page or triggers the right action
6. Steps that are already complete show a green checkmark
7. Future steps (after the next one) are dimmed
8. When all 3 steps are complete, the checklist shows "Setup complete!" with a dismiss button
9. Dismissing stores in localStorage so the checklist doesn't reappear
10. The checklist doesn't appear when data is still loading (no flash)
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useQuery(api.users.getProfile)` to check GitHub connection status (already available on the settings page pattern)
- The `hasAnyRepos` query is efficient — it exits early on the first repo found, no need to load all repos
- Make sure the `teamMembers` table has a `by_userId` index (check schema). If not, use the existing `listMyTeams` logic as reference.
- localStorage for dismissal is fine — this is a UX preference, not critical state. SSR-safe with a `typeof window` check.
- The onboarding checklist should have a subtle, non-intrusive design — a bordered card with a light background, not a modal or blocking overlay.
- The "Connect GitHub" step links to `/settings` rather than inlining the OAuth flow, since the OAuth flow involves a redirect to GitHub and back.
- The "Connect a repository" step links to the first team's page. If the user has multiple teams, they can choose which to connect repos to from the team page.

## Completion Summary

### Status: Already Implemented

The onboarding flow was already fully implemented by a previous task. Verified all acceptance criteria pass:

### Files Involved
| File | Status | Description |
|------|--------|-------------|
| `src/app/(dashboard)/home/page.tsx` | **Already modified** | Contains `OnboardingChecklist` component with full step tracking, progress bar, action buttons, "Setup complete!" state, and localStorage-based dismissal |
| `convex/projects.ts` | **Already modified** | Contains `hasAnyRepos` query that efficiently checks if user has any repos across all teams (early exit on first found) |

### Verified Acceptance Criteria
1. Checklist renders at top of dashboard for users who haven't dismissed it
2. Shows 3 steps: Create a team, Connect GitHub, Connect a repository
3. Each step shows done/pending status with checkmark or numbered circle icon
4. Progress indicator shows "X of 3 complete" with animated progress bar
5. Next step has clickable action button (Create Team button, Connect GitHub link, Browse Repos link)
6. Completed steps show green checkmark with strikethrough text
7. Future steps are dimmed (opacity-50)
8. "Setup complete!" banner with green styling when all 3 done
9. Dismiss button stores `artie_onboarding_dismissed=true` in localStorage
10. No flash on load (starts with `dismissed=true`, checks localStorage in useEffect)
11. `npm -s tsc -p tsconfig.json --noEmit` passes with zero errors

### Browser Testing
- Logged in and verified dashboard renders correctly
- "Setup complete!" banner visible for user with all steps done
- Dismiss button works and persists across page reloads via localStorage
