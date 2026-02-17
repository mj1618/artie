# Task: Add GitHub OAuth Connect Flow

## Context

The PLAN.md (Phase 2) specifies GitHub OAuth so team owners can connect their GitHub account to Artie. Currently, `convex/github.ts` uses a single `GITHUB_TOKEN` env var for all GitHub API calls. This means:
- Only one GitHub account is supported across all users
- Users can't access their private repos
- Commits are attributed to whoever owns the env var token, not the actual user
- There's no way for an owner to "connect their GitHub" in the app

The schema already has `githubAccessToken` and `githubUsername` on `userProfiles`, but they're never populated. This task implements the full GitHub OAuth flow: redirect to GitHub, handle the callback, exchange code for token, store it, and use it for GitHub API calls.

### What exists now:
- `convex/schema.ts` — `userProfiles` table has optional `githubAccessToken` and `githubUsername` fields
- `convex/users.ts` — `getProfile`, `updateProfile` queries/mutations. No GitHub-related mutations.
- `convex/github.ts` — All actions use `createOctokit()` which reads `process.env.GITHUB_TOKEN`. No per-user token support.
- `convex/http.ts` — HTTP router with only auth routes
- `src/app/(dashboard)/settings/page.tsx` — Account settings page (display name)
- No GitHub OAuth callback route exists anywhere

### What's missing:
- No Next.js API route to initiate GitHub OAuth (redirect to `github.com/login/oauth/authorize`)
- No callback route to handle GitHub's redirect back with the authorization code
- No backend action to exchange the code for an access token
- No mutation to store the token on the user profile
- No UI on the settings page to "Connect GitHub" / show connected status
- `convex/github.ts` doesn't look up per-user tokens from `userProfiles`

## Requirements

### 1. Create Next.js API route to initiate GitHub OAuth: `src/app/api/github/authorize/route.ts`

This route redirects the user to GitHub's OAuth authorization page:

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
  }

  // Generate a random state parameter to prevent CSRF
  const state = crypto.randomUUID();

  // Store state in a cookie for validation on callback
  const redirectUrl = new URL("https://github.com/login/oauth/authorize");
  redirectUrl.searchParams.set("client_id", clientId);
  redirectUrl.searchParams.set("redirect_uri", `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`);
  redirectUrl.searchParams.set("scope", "repo");
  redirectUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
```

### 2. Create Next.js API route for the OAuth callback: `src/app/api/github/callback/route.ts`

This route handles GitHub's redirect back with the authorization code:

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("github_oauth_state")?.value;

  // Validate state to prevent CSRF
  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL("/settings?error=github_oauth_failed", req.url));
  }

  // Exchange code for access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL("/settings?error=github_token_failed", req.url));
  }

  // Get GitHub username
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const githubUser = await userResponse.json();

  // Store the token via Convex mutation
  // We'll pass the token and username as query params to a special page that calls the mutation
  // (Since this is a server-side route, we can't call Convex mutations directly without auth context)
  const redirectUrl = new URL("/settings", req.url);
  redirectUrl.searchParams.set("github_token", tokenData.access_token);
  redirectUrl.searchParams.set("github_username", githubUser.login);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete("github_oauth_state");
  return response;
}
```

**Note:** Passing the token as a query param is a temporary approach. A more secure approach would be to use a Convex HTTP action as the callback endpoint, but this requires additional setup. The settings page will immediately consume the query params and call a Convex mutation, then clear the URL.

### 3. Add `connectGithub` mutation to `convex/users.ts`

```typescript
export const connectGithub = mutation({
  args: {
    githubAccessToken: v.string(),
    githubUsername: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch("userProfiles", profile._id, {
        githubAccessToken: args.githubAccessToken,
        githubUsername: args.githubUsername,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: args.githubUsername,
        githubAccessToken: args.githubAccessToken,
        githubUsername: args.githubUsername,
      });
    }
  },
});
```

Also add a `disconnectGithub` mutation:

```typescript
export const disconnectGithub = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch("userProfiles", profile._id, {
        githubAccessToken: undefined,
        githubUsername: undefined,
      });
    }
  },
});
```

### 4. Update `convex/github.ts` to use per-user tokens

Modify `createOctokit()` to accept an optional token parameter, and update the `getRepo` helper to also fetch the user's token:

```typescript
function createOctokit(token?: string) {
  return new Octokit({
    auth: token || process.env.GITHUB_TOKEN,
  });
}
```

Add an internal helper to get the authenticated user's GitHub token:

```typescript
async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return undefined;
  const profile = await ctx.runQuery(api.users.getProfile);
  return profile?.githubAccessToken ?? undefined;
}
```

Update all actions (`fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer`, `commitToDefault`, `commitToBranch`, `pushChanges`) to get the user's token and pass it to `createOctokit()`:

```typescript
const token = await getUserGithubToken(ctx);
const octokit = createOctokit(token);
```

This way: if the user has connected GitHub, their token is used (giving access to their private repos). If not, the fallback `GITHUB_TOKEN` env var is used (public repos only).

### 5. Add GitHub connection UI to the account settings page: `src/app/(dashboard)/settings/page.tsx`

Add a "GitHub Connection" section below the display name form:

- **Not connected state**: Show a "Connect GitHub" button that links to `/api/github/authorize`
- **Connected state**: Show the GitHub username with a green checkmark and a "Disconnect" button
- **On page load**: Check for `github_token` and `github_username` query params (from OAuth callback). If present, call the `connectGithub` mutation and clear the URL params.
- **Error state**: If `error=github_oauth_failed` is in the URL, show an error toast

```tsx
function GitHubConnection() {
  const profile = useQuery(api.users.getProfile);
  const connectGithub = useMutation(api.users.connectGithub);
  const disconnectGithub = useMutation(api.users.disconnectGithub);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);

  // Handle OAuth callback params
  useEffect(() => {
    const token = searchParams.get("github_token");
    const username = searchParams.get("github_username");
    if (token && username) {
      connectGithub({ githubAccessToken: token, githubUsername: username })
        .then(() => {
          toast({ type: "success", message: `Connected as ${username}` });
          router.replace("/settings"); // Clear URL params
        })
        .catch(() => {
          toast({ type: "error", message: "Failed to save GitHub connection" });
          router.replace("/settings");
        });
    }
    const error = searchParams.get("error");
    if (error) {
      toast({ type: "error", message: "GitHub connection failed. Please try again." });
      router.replace("/settings");
    }
  }, [searchParams]);

  if (profile === undefined) return <CardSkeleton />;

  const isConnected = !!profile?.githubUsername;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-lg font-semibold text-zinc-200">GitHub Connection</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Connect your GitHub account to access private repos and push changes.
      </p>
      {isConnected ? (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Green checkmark */}
            <span className="text-green-400">Connected as <strong>{profile.githubUsername}</strong></span>
          </div>
          <button onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <a href="/api/github/authorize" className="mt-4 inline-block rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700">
          Connect GitHub
        </a>
      )}
    </div>
  );
}
```

### 6. Run codegen and verify

- Run `npm -s run convex codegen` if needed
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/github/authorize/route.ts` | **Create** | OAuth initiation route — redirects to GitHub |
| `src/app/api/github/callback/route.ts` | **Create** | OAuth callback route — exchanges code for token, redirects to settings |
| `convex/users.ts` | **Modify** | Add `connectGithub` and `disconnectGithub` mutations |
| `convex/github.ts` | **Modify** | Update `createOctokit` to accept per-user tokens; add `getUserGithubToken` helper; update all actions to use per-user tokens with env var fallback |
| `src/app/(dashboard)/settings/page.tsx` | **Modify** | Add GitHub connection section with connect/disconnect UI and OAuth callback handling |

## Acceptance Criteria

1. A "Connect GitHub" button appears on the account settings page when GitHub is not connected
2. Clicking "Connect GitHub" redirects to GitHub's OAuth authorization page
3. After authorizing on GitHub, the user is redirected back to the settings page
4. The OAuth callback exchanges the code for an access token and stores it in the user profile
5. The settings page shows "Connected as {username}" with a green indicator when connected
6. A "Disconnect" button removes the GitHub token from the user profile
7. `convex/github.ts` actions use the authenticated user's token when available, falling back to `GITHUB_TOKEN` env var
8. CSRF protection via state parameter in the OAuth flow
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- GitHub OAuth docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- The `repo` scope gives full access to private and public repos
- The state parameter prevents CSRF by ensuring the callback came from a request we initiated
- Per-user tokens mean commits are attributed to the correct GitHub user
- Fallback to `GITHUB_TOKEN` env var ensures the app works in demo mode without requiring every user to connect GitHub
- In the future, this could be upgraded to GitHub Apps (which have higher rate limits and per-repo permissions), but OAuth Apps are simpler for now
- The token is stored in plaintext for now. A follow-up task could add encryption (the PLAN.md mentions AES-256 encryption). This is acceptable for MVP since Convex stores data securely and the token is never exposed to the frontend (except briefly during the OAuth callback redirect).
- `getAuthUserId` works in actions (Convex actions have auth context), so `getUserGithubToken` can be used in all github.ts actions.

---

## Implementation Summary

### Files Created
- `src/app/api/github/authorize/route.ts` — OAuth initiation route that redirects to GitHub's authorization page with CSRF state parameter stored in a cookie
- `src/app/api/github/callback/route.ts` — OAuth callback route that validates CSRF state, exchanges authorization code for access token, fetches GitHub username, and redirects to settings page with token/username params

### Files Modified
- `convex/users.ts` — Added `connectGithub` mutation (stores GitHub access token and username on user profile) and `disconnectGithub` mutation (clears GitHub credentials)
- `convex/github.ts` — Updated `createOctokit()` to accept optional per-user token; added `getUserGithubToken()` helper; updated all 6 actions (`fetchRepoTree`, `fetchFileContents`, `fetchRepoForWebContainer`, `commitToDefault`, `commitToBranch`, `pushChanges`) to use per-user tokens with env var fallback
- `src/app/(dashboard)/settings/page.tsx` — Added `GitHubConnection` component showing connect/disconnect UI, handles OAuth callback params via `useSearchParams`, wrapped with Suspense boundary

### What Was Built
- Full GitHub OAuth flow: initiate → GitHub authorization → callback → token exchange → store in user profile
- CSRF protection via random state parameter in cookie
- Settings page shows "Connect GitHub" button when not connected, "Connected as {username}" with green checkmark and Disconnect button when connected
- All GitHub API calls now use the authenticated user's token when available, falling back to `GITHUB_TOKEN` env var
- TypeScript passes with no errors, build succeeds

---

## Review (Reviewer Agent)

Reviewed all 5 files (2 created, 3 modified). Checked for:
- TypeScript errors: `tsc --noEmit` passes cleanly
- Convex codegen: up to date, no issues
- `"use client"` directives: present on settings page (the only client component)
- Import paths: consistent with codebase convention (relative `../../../../convex/` style)
- Suspense boundary: correctly wraps component using `useSearchParams` (Next.js App Router requirement)
- React Strict Mode double-fire: handled with `handledRef`
- Convex API usage: `db.patch` uses two-argument style per CLAUDE.md instructions
- Error/loading states: handled throughout (skeleton fallbacks, toast errors, disabled states)
- OAuth security: CSRF state parameter, httpOnly cookie, proper validation

No issues found. All code looks correct.

## Review (38a3f7a1)

Second review pass — independently verified all 5 files:

- **TypeScript**: `tsc --noEmit` passes cleanly, `convex codegen` succeeds
- **OAuth routes**: CSRF state parameter validation is correct; cookie settings (httpOnly, secure in production, sameSite lax, 10-min maxAge) are appropriate
- **Schema alignment**: `githubAccessToken` and `githubUsername` are `v.optional(v.string())` in schema — `disconnectGithub` correctly passes `undefined` to clear them
- **`getUserGithubToken` in github.ts**: Correctly calls `api.users.getProfile` which uses `getAuthUserId` internally — works in Convex action context
- **Per-user token fallback**: All 6 GitHub actions now call `getUserGithubToken(ctx)` then `createOctokit(token)` — falls back to `process.env.GITHUB_TOKEN` when token is undefined
- **Settings page**: `handledRef` prevents React Strict Mode double-fire; `useSearchParams` is wrapped in Suspense boundary; toast API matches `useToast` interface
- **Imports**: All resolve correctly — `useToast` from `@/lib/useToast`, `api` from relative convex path, skeleton components from `@/components/ui/DashboardSkeleton`

No fixes needed.

## Review (c8012fc0)

Reviewed all 5 files. OAuth CSRF state validation correct, httpOnly cookie settings appropriate. `connectGithub`/`disconnectGithub` mutations align with schema. Settings page `GitHubConnection` uses `handledRef` for Strict Mode, `Suspense` wraps `useSearchParams`. Per-user tokens threaded through all GitHub actions correctly. TypeScript passes, codegen succeeds. No issues found, no fixes needed.
