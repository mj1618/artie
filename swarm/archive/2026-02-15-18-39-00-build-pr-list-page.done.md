# Task: Build Pull Request List Page

## Context

The PLAN.md (Phase 5) specifies: "PR list view for owners (open PRs for connected repos)" and "PR preview in WebContainers." Currently there is no pull requests page at all — no backend action to fetch PRs and no UI to view them. This is a major gap: owners who use the "PR" push strategy see PRs created on GitHub but have no way to review them within Artie.

### What exists now:
- `convex/github.ts` — Has `getUserGithubToken(ctx)`, `createOctokit(token)`, `getRepo()` helpers. Has `listUserRepos` action. Has `commitToBranch` that creates PRs.
- `convex/projects.ts` — Has `listByTeam` query and `get` query for repos.
- `convex/schema.ts` — `repos` table with `teamId`, `githubOwner`, `githubRepo`, `defaultBranch`, `pushStrategy`.
- `src/components/layout/Sidebar.tsx` — Sidebar with Home, Settings, Teams, and repos. No "Pull Requests" link.
- No `src/app/(dashboard)/pull-requests/` directory or page exists.

### What's missing:
- No Convex action to list open PRs for connected repos
- No pull requests page to display them
- No sidebar link to navigate to PRs

## Requirements

### 1. Add `listOpenPullRequests` action to `convex/github.ts`

Create a new action that fetches open PRs across all repos the user has access to:

```typescript
export const listOpenPullRequests = action({
  args: {},
  handler: async (ctx) => {
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected. Please connect your GitHub account in Settings.");
    }
    const octokit = createOctokit(token);

    // Get all teams and repos the user belongs to
    const teams = await ctx.runQuery(api.teams.listMyTeams);
    const allRepos: Array<{ repoId: string; githubOwner: string; githubRepo: string; teamName: string }> = [];

    for (const team of teams) {
      const repos = await ctx.runQuery(api.projects.listByTeam, { teamId: team._id });
      for (const repo of repos) {
        allRepos.push({
          repoId: repo._id,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          teamName: team.name,
        });
      }
    }

    // Fetch open PRs for each repo in parallel
    const prsByRepo = await Promise.all(
      allRepos.map(async (repo) => {
        try {
          const { data: prs } = await octokit.pulls.list({
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            state: "open",
            sort: "updated",
            direction: "desc",
            per_page: 30,
          });

          return prs.map((pr) => ({
            repoId: repo.repoId,
            repoFullName: `${repo.githubOwner}/${repo.githubRepo}`,
            teamName: repo.teamName,
            prNumber: pr.number,
            title: pr.title,
            body: pr.body ?? "",
            author: pr.user?.login ?? "unknown",
            authorAvatar: pr.user?.avatar_url ?? "",
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            headBranch: pr.head.ref,
            baseBranch: pr.base.ref,
            isDraft: pr.draft ?? false,
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changed_files,
            htmlUrl: pr.html_url,
          }));
        } catch (err) {
          console.error(`Failed to fetch PRs for ${repo.githubOwner}/${repo.githubRepo}:`, err);
          return [];
        }
      }),
    );

    // Flatten and sort by updatedAt descending
    return prsByRepo
      .flat()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },
});
```

### 2. Create the PR list page at `src/app/(dashboard)/pull-requests/page.tsx`

A new page accessible from the sidebar that shows all open PRs across the user's connected repos:

```tsx
"use client";

import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import { useToast } from "@/lib/useToast";
import { CardSkeleton } from "@/components/ui/DashboardSkeleton";

interface PullRequest {
  repoId: string;
  repoFullName: string;
  teamName: string;
  prNumber: number;
  title: string;
  body: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  htmlUrl: string;
}

export default function PullRequestsPage() {
  const listPRs = useAction(api.github.listOpenPullRequests);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    listPRs({})
      .then(setPrs)
      .catch((err) => {
        setError(err.message);
        toast({ type: "error", message: "Failed to load pull requests" });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Pull Requests</h1>
        <button
          onClick={() => { setLoading(true); listPRs({}).then(setPrs).catch((e) => setError(e.message)).finally(() => setLoading(false)); }}
          disabled={loading}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="mt-6 space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-lg border border-red-800/50 bg-red-900/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {prs && !loading && prs.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No open pull requests across your connected repositories.
        </div>
      )}

      {prs && !loading && prs.length > 0 && (
        <div className="mt-6 space-y-3">
          {prs.map((pr) => (
            <PRCard key={`${pr.repoFullName}-${pr.prNumber}`} pr={pr} />
          ))}
        </div>
      )}
    </div>
  );
}

// PRCard component renders a single PR summary card
// Shows: title, repo name, author, branch info, additions/deletions stats,
// draft indicator, relative time, and a link to view on GitHub (later: in-app review)
```

### 3. Add "Pull Requests" link to Sidebar

Add a "Pull Requests" nav item in `src/components/layout/Sidebar.tsx` below Settings:

```tsx
<NavItem
  href="/pull-requests"
  label="Pull Requests"
  active={pathname === "/pull-requests"}
/>
```

### 4. Run codegen and verify

- Run `npx convex dev --once` to regenerate API types with the new action
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add `listOpenPullRequests` action that fetches open PRs for all connected repos via Octokit |
| `src/app/(dashboard)/pull-requests/page.tsx` | **Create** | Pull requests list page showing open PRs across all repos with loading/empty/error states |
| `src/components/layout/Sidebar.tsx` | **Modify** | Add "Pull Requests" nav link below Settings |

## Acceptance Criteria

1. A new "Pull Requests" link appears in the sidebar navigation
2. Clicking the link navigates to `/pull-requests` and shows the PR list page
3. The page fetches open PRs from all connected repos using the user's GitHub token
4. Each PR card shows: title, repo name, author, branch info (head → base), additions/deletions stats, time since update
5. Draft PRs are visually distinguished (e.g., muted text or a "Draft" badge)
6. The page shows a loading skeleton while fetching
7. An empty state message appears when there are no open PRs
8. An error state appears if the GitHub API call fails (e.g., no GitHub connected)
9. A "Refresh" button re-fetches the PR list
10. PRs are sorted by most recently updated
11. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useAction` (not `useQuery`) since `listOpenPullRequests` calls GitHub API — actions are one-shot, not subscribed
- Call the action in a `useEffect` on mount (same pattern as `RepoBrowser` in the team page)
- `octokit.pulls.list` returns additions/deletions/changed_files per PR — useful for showing stats
- The page should group PRs by repo if there are many, but for now a flat sorted list is fine
- The `PRCard` should link to `htmlUrl` (GitHub PR page) for now — a future task will add an in-app PR review page at `/pull-requests/[repoId]/[prNumber]`
- Fetching PRs for multiple repos in parallel via `Promise.all` keeps the action fast
- Per-repo errors are caught and logged so one failing repo doesn't block the others
- The sidebar link goes in the top nav section (Home, Settings, Pull Requests) since it's a cross-team view

## Implementation Summary

### Files Modified
- **`convex/github.ts`** — Added `listOpenPullRequests` action that fetches open PRs across all connected repos via Octokit. Fetches repos for all teams in parallel, catches per-repo errors so one failing repo doesn't block others, and returns PRs sorted by most recently updated.
- **`src/components/layout/Sidebar.tsx`** — Added "Pull Requests" nav link below Settings in the top nav section.

### Files Created
- **`src/app/(dashboard)/pull-requests/page.tsx`** — Pull requests list page with loading skeleton, error state, empty state, and PR cards. Each card shows title, repo name, PR number, author with avatar, branch info (head → base), relative time, and draft badge. Cards link to the in-app PR detail route (`/pull-requests/[repoId]/[prNumber]`). Includes a "Refresh" button to re-fetch.

### Notes
- `octokit.pulls.list` does not return `additions`/`deletions`/`changed_files` (those are only on `pulls.get`), so those stats were omitted from the list view. They can be shown on the detail page instead.
- TypeScript passes cleanly (`tsc --noEmit` and `convex codegen` both succeed).
- Browser-tested: sidebar link navigates to the page, PR cards render correctly with real data from GitHub.

## Review (c0720722)

### Files Reviewed
- `convex/github.ts` — `listOpenPullRequests`, `getPullRequestDetail`, `mergePullRequest` actions
- `src/app/(dashboard)/pull-requests/page.tsx` — PR list page
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — PR detail/review page
- `src/components/layout/Sidebar.tsx` — Pull Requests nav link
- `src/components/ui/DashboardSkeleton.tsx` — `CardSkeleton` (used by both pages)

### Issues Found & Fixed
1. **Incorrect `dark:` prefix in PatchView** — The diff hunk header (`@@` lines) in `[repoId]/[prNumber]/page.tsx` used `bg-zinc-200/50 text-zinc-500 dark:bg-zinc-700/50 dark:text-zinc-400`. The app is always in a dark theme (no `dark:` class on the html element, no other files use `dark:` prefix). This caused hunk headers to render with light-mode colors (`bg-zinc-200/50`) against the dark background. Fixed by removing the `dark:` prefixes and using the dark colors directly: `bg-zinc-700/50 text-zinc-400`.

### No Issues Found
- All imports resolve correctly (`useToast`, `CardSkeleton`, `MarkdownContent`, `api`)
- `"use client"` directive present on both pages
- Frontend TypeScript interfaces correctly match backend action return types
- `listOpenPullRequests` properly omits `additions`/`deletions`/`changedFiles` (not returned by `pulls.list`); these are correctly present in `getPullRequestDetail` (which uses `pulls.get`)
- Error/loading/empty states are all handled
- `tsc --noEmit` passes cleanly

## Review (2df0b77b)

### Files Reviewed
- `convex/github.ts` — `listOpenPullRequests`, `getPullRequestDetail`, `mergePullRequest` actions
- `src/app/(dashboard)/pull-requests/page.tsx` — PR list page
- `src/app/(dashboard)/pull-requests/[repoId]/[prNumber]/page.tsx` — PR detail/review page
- `src/components/layout/Sidebar.tsx` — Pull Requests nav link
- `src/components/ui/DashboardSkeleton.tsx` — `CardSkeleton` component

### Issues Found & Fixed
1. **Sidebar "Pull Requests" link not active on detail pages** — The nav item used `pathname === "/pull-requests"` (exact match), so navigating to `/pull-requests/[repoId]/[prNumber]` would not highlight the sidebar link. Changed to `pathname.startsWith("/pull-requests")` to match the pattern used for team pages.

### No Issues Found
- All imports resolve correctly; relative convex imports match existing codebase conventions
- `"use client"` directive present on both pages
- Backend action return types match frontend TypeScript interfaces
- `CardSkeleton` accepts the `lines` prop used by the detail page
- Error/loading/empty states handled on both pages
- Merge controls properly disable when `mergeable === false`
- Branch deletion after merge is wrapped in try/catch for the case where the branch was already deleted
- `tsc --noEmit` passes cleanly after fix
