# Task: Add GitHub Repo Browser to Team Page

## Context

The PLAN.md (Phase 2) specifies: "List available repositories" and "Owner selects which repos to connect." Currently, adding a repo requires the owner to manually type the GitHub owner name and repo name into text fields (`AddRepoForm` in `src/app/(dashboard)/team/[teamId]/page.tsx`). This is error-prone and doesn't leverage the GitHub OAuth connection being built in the current task.

Once the GitHub OAuth flow is complete, users will have a `githubAccessToken` stored on their `userProfiles`. This task uses that token to fetch the user's actual GitHub repos via the GitHub API and display them in a browsable list, so owners can click to connect repos instead of typing names.

### What exists now:
- `convex/github.ts` — Has `createOctokit(token?)` and `getUserGithubToken(ctx)` helper. Actions use per-user tokens when available.
- `convex/users.ts` — Has `getProfile` query returning `githubAccessToken` and `githubUsername`
- `convex/projects.ts` — Has `addRepo` mutation taking `teamId`, `githubOwner`, `githubRepo`, `defaultBranch`, `pushStrategy`
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Has manual `AddRepoForm` with owner/repo text fields
- GitHub OAuth flow (being built concurrently) will populate `githubAccessToken` on user profiles

### What's missing:
- No Convex action to list the authenticated user's GitHub repos
- No UI to browse and select from available GitHub repos
- The manual form is the only way to add repos

## Requirements

### 1. Add `listUserRepos` action to `convex/github.ts`

Create a new action that fetches the authenticated user's GitHub repos using their stored token:

```typescript
export const listUserRepos = action({
  args: {},
  handler: async (ctx) => {
    const token = await getUserGithubToken(ctx);
    if (!token) {
      throw new Error("GitHub account not connected. Please connect your GitHub account in Settings first.");
    }
    const octokit = createOctokit(token);

    // Fetch repos the user has push access to (they own or collaborate on)
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
      affiliation: "owner,collaborator,organization_member",
    });

    return data.map((repo) => ({
      fullName: repo.full_name,
      owner: repo.owner?.login ?? "",
      name: repo.name,
      description: repo.description ?? "",
      defaultBranch: repo.default_branch ?? "main",
      private: repo.private,
      updatedAt: repo.updated_at ?? "",
    }));
  },
});
```

### 2. Replace `AddRepoForm` with a `AddRepoSection` in `src/app/(dashboard)/team/[teamId]/page.tsx`

Replace the manual text form with a smarter component that:

1. **If GitHub is connected**: Shows a "Browse Repos" button. When clicked, calls `listUserRepos` and displays a searchable list of repos. Each repo shows owner/name, description, and a "Connect" button. Clicking "Connect" opens a small inline form to pick push strategy (PR or Direct), then calls `addRepo`.

2. **If GitHub is NOT connected**: Shows a message "Connect your GitHub account to browse repos" with a link to `/settings`. Also keeps a "Manual entry" fallback link that reveals the old text-input form.

3. **Search/filter**: A text input to filter the repo list by name as the user types.

4. **Already-connected indicator**: Repos that are already connected to this team should show "Connected" badge instead of a "Connect" button. Cross-reference with the `repos` query for this team.

```tsx
function AddRepoSection({ teamId }: { teamId: Id<"teams"> }) {
  const profile = useQuery(api.users.getProfile);
  const existingRepos = useQuery(api.projects.listByTeam, { teamId });
  const [showBrowser, setShowBrowser] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const hasGithub = !!profile?.githubUsername;

  if (hasGithub && showBrowser) {
    return <RepoBrowser teamId={teamId} existingRepos={existingRepos ?? []} onClose={() => setShowBrowser(false)} />;
  }

  if (showManual) {
    return <AddRepoForm teamId={teamId} onClose={() => setShowManual(false)} />;
  }

  return (
    <div className="px-4 py-3">
      {hasGithub ? (
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBrowser(true)} className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Browse GitHub Repos
          </button>
          <button onClick={() => setShowManual(true)} className="text-xs text-zinc-500 hover:text-zinc-300">
            or enter manually
          </button>
        </div>
      ) : (
        <div className="text-sm text-zinc-400">
          <a href="/settings" className="text-blue-400 hover:text-blue-300">Connect your GitHub account</a> to browse repos, or{" "}
          <button onClick={() => setShowManual(true)} className="text-zinc-300 underline">enter manually</button>.
        </div>
      )}
    </div>
  );
}
```

### 3. Build `RepoBrowser` component

```tsx
function RepoBrowser({ teamId, existingRepos, onClose }: {
  teamId: Id<"teams">;
  existingRepos: Array<{ githubOwner: string; githubRepo: string }>;
  onClose: () => void;
}) {
  const listRepos = useAction(api.github.listUserRepos);
  const addRepo = useMutation(api.projects.addRepo);
  const [repos, setRepos] = useState<Array<{...}> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<Record<string, "direct" | "pr">>({});
  const { toast } = useToast();

  useEffect(() => {
    listRepos({})
      .then(setRepos)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = repos?.filter(r =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const isConnected = (owner: string, name: string) =>
    existingRepos.some(r => r.githubOwner === owner && r.githubRepo === name);

  async function handleConnect(repo: { owner: string; name: string; defaultBranch: string }) {
    const key = `${repo.owner}/${repo.name}`;
    setConnecting(key);
    try {
      await addRepo({
        teamId,
        githubOwner: repo.owner,
        githubRepo: repo.name,
        defaultBranch: repo.defaultBranch,
        pushStrategy: selectedStrategy[key] ?? "pr",
      });
      toast({ type: "success", message: `Connected ${key}` });
    } catch (err) {
      toast({ type: "error", message: err instanceof Error ? err.message : "Failed to connect" });
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Your GitHub Repositories</h3>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search repos..."
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 mb-3"
      />
      {loading && <p className="text-sm text-zinc-500">Loading repos from GitHub...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {filtered && (
        <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-800 rounded border border-zinc-800">
          {filtered.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const connected = isConnected(repo.owner, repo.name);
            return (
              <li key={key} className="flex items-center justify-between px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-200">{repo.fullName}</p>
                  {repo.description && (
                    <p className="text-xs text-zinc-500 truncate">{repo.description}</p>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                    <span>{repo.defaultBranch}</span>
                    {repo.private && <span className="text-amber-400">Private</span>}
                  </div>
                </div>
                {connected ? (
                  <span className="text-xs text-emerald-400 font-medium">Connected</span>
                ) : (
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <select
                      value={selectedStrategy[key] ?? "pr"}
                      onChange={(e) => setSelectedStrategy(s => ({ ...s, [key]: e.target.value as "direct" | "pr" }))}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                    >
                      <option value="pr">PR</option>
                      <option value="direct">Direct</option>
                    </select>
                    <button
                      onClick={() => handleConnect(repo)}
                      disabled={connecting === key}
                      className="rounded bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                    >
                      {connecting === key ? "..." : "Connect"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-zinc-500">
              No repos match your search
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

### 4. Update the existing `AddRepoForm` to accept an `onClose` prop

Add an `onClose` callback prop so the form can be dismissed when embedded in the `AddRepoSection`:

```tsx
function AddRepoForm({ teamId, onClose }: { teamId: Id<"teams">; onClose?: () => void }) {
  // ... existing code ...
  // Add a "Cancel" button next to "Connect" that calls onClose
}
```

### 5. Run codegen and verify

- Run `npx convex dev --once` to regenerate API types with the new `listUserRepos` action
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/github.ts` | **Modify** | Add `listUserRepos` action that fetches authenticated user's repos via Octokit |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Replace `AddRepoForm` section with `AddRepoSection` containing `RepoBrowser` and manual fallback |

## Acceptance Criteria

1. A "Browse GitHub Repos" button appears on the team page when the user's GitHub is connected
2. Clicking the button fetches and displays the user's GitHub repos (sorted by recently updated)
3. Each repo shows full name, description, default branch, and private/public indicator
4. A search input filters repos by name in real-time
5. Repos already connected to this team show a "Connected" badge instead of a "Connect" button
6. Clicking "Connect" on a repo lets the user pick push strategy (PR/Direct) and connects it
7. When GitHub is NOT connected, a link to Settings is shown with a manual-entry fallback
8. The manual entry form still works as a fallback
9. A toast confirms successful connection or shows errors
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- `octokit.repos.listForAuthenticatedUser` returns repos sorted by update time with `sort: "updated"`
- The `affiliation` parameter controls which repos are returned: `owner` (repos the user owns), `collaborator` (repos they're a collaborator on), `organization_member` (repos in orgs they belong to)
- `per_page: 100` is the GitHub API maximum per page. For users with more than 100 repos, pagination could be added later, but 100 covers most users.
- The repo browser uses a Convex action (not query) because it calls the GitHub API. Actions are one-shot and don't subscribe to updates, which is appropriate here.
- `useAction` returns a function that must be called manually (unlike `useQuery` which auto-subscribes). We call it in a `useEffect` on mount.
- Cross-referencing with `existingRepos` uses the already-subscribed `listByTeam` query, so connected status updates in real-time when a repo is added.
- The `private` field from GitHub API tells us if a repo is private — shown with an amber "Private" indicator so users understand they need the OAuth connection for these repos.

---

## Completion Summary

### What was built
- **`listUserRepos` Convex action** in `convex/github.ts` — Fetches the authenticated user's GitHub repos using their stored OAuth token via Octokit. Returns repo metadata (full name, owner, name, description, default branch, private status, updated date). Uses `affiliation: "owner,collaborator,organization_member"` and `per_page: 100`.
- **`RepoBrowser` component** — Displays a searchable, scrollable list of the user's GitHub repos. Each repo shows full name, description, default branch, and private indicator. Already-connected repos show a "Connected" badge. Unconnected repos have a push strategy dropdown (PR/Direct) and a "Connect" button.
- **`AddRepoSection` component** — Smart wrapper that checks if GitHub is connected. If yes, shows "Browse GitHub Repos" button + "or enter manually" link. If no, shows a link to Settings to connect GitHub + manual entry fallback.
- **Updated `AddRepoForm`** — Now accepts optional `onClose` prop and shows a Cancel button when provided.
- **Replaced direct `AddRepoForm` usage** in `TeamManagementPage` with `AddRepoSection`.

### Files changed
| File | Change |
|------|--------|
| `convex/github.ts` | Added `listUserRepos` action (lines 94-121) |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | Added `useEffect`, `useAction` imports; updated `AddRepoForm` with `onClose` prop; added `GithubRepo` interface, `RepoBrowser` component, `AddRepoSection` component; replaced `AddRepoForm` usage with `AddRepoSection` in page render |

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed (zero errors)
- `npm run build` — passed (standalone build successful)
- Browser testing: app builds and renders correctly; auth redirect works as expected (full interactive testing blocked by missing `JWT_PRIVATE_KEY` env var in Convex deployment)

## Review (00adcf52)

Reviewed `convex/github.ts` (listUserRepos action) and `src/app/(dashboard)/team/[teamId]/page.tsx` (RepoBrowser, AddRepoSection, AddRepoForm):

- **TypeScript**: `tsc --noEmit` passes cleanly, `convex codegen` succeeds
- **`"use client"` directive**: Present on team page (line 1) — correct since it uses hooks
- **Imports**: All resolve correctly — `useAction` from `convex/react`, `api` from relative convex path, `useToast` from `@/lib/useToast`, `ConfirmDialog` and skeleton components all present
- **`listUserRepos` action**: Correctly uses `getUserGithubToken(ctx)` and throws descriptive error if no token; `createOctokit(token)` properly used
- **`RepoBrowser` component**: `useEffect` with `listRepos` dep correctly fires on mount; loading/error states handled; search filter works on `fullName`; `isConnected` cross-references existing repos properly
- **`AddRepoSection` component**: Conditional rendering based on `profile?.githubUsername` is correct; manual fallback preserved
- **`AddRepoForm`**: `onClose` prop is optional — backward compatible with any other callers
- **Schema alignment**: `repos` table fields (`githubOwner`, `githubRepo`, `defaultBranch`, `pushStrategy`) match what `addRepo` mutation and `RepoBrowser` pass
- **`GithubRepo` interface**: Matches the return shape from `listUserRepos` action

No fixes needed.

## Review (c8012fc0)

Reviewed `convex/github.ts` (`listUserRepos`) and team page (`RepoBrowser`, `AddRepoSection`, `AddRepoForm`). All correct — `listUserRepos` properly requires user token, `RepoBrowser` uses `useAction` in `useEffect`, cross-references existing repos for "Connected" badge, `AddRepoForm` `onClose` is optional. TypeScript passes, codegen succeeds. No issues found, no fixes needed.
