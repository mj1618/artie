# Task: Fix AI Context to Use Per-User GitHub Tokens

## Context

The GitHub OAuth connect flow (being built) allows users to connect their GitHub account and store a personal access token on their `userProfiles`. The `convex/github.ts` actions already use `getUserGithubToken(ctx)` to fetch the user's token with a fallback to `process.env.GITHUB_TOKEN`.

However, `convex/ai.ts` has its **own** Octokit instance that hardcodes `process.env.GITHUB_TOKEN` (line 232):

```typescript
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
```

This means the AI context-building step bypasses the per-user token system entirely. When a user connects their GitHub account, the AI still can't access their private repos because it uses the global env token. This is a critical gap.

### What exists now:
- `convex/ai.ts` — `generateResponse` action creates its own `Octokit` with `process.env.GITHUB_TOKEN` to fetch the file tree and file contents for AI context (lines 232-296)
- `convex/github.ts` — Has `getUserGithubToken(ctx)` helper and `createOctokit(token?)` that all other actions use correctly
- `convex/users.ts` — Has `getProfile` query that returns `githubAccessToken`
- `convex/schema.ts` — `userProfiles` has optional `githubAccessToken` and `githubUsername` fields

### The bug:
`ai.ts` line 232: `const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })` should use the user's token when available.

## Requirements

### 1. Add `getUserGithubToken` helper to `convex/ai.ts`

Import the necessary APIs and add a helper to fetch the user's GitHub token (same pattern as `github.ts`):

```typescript
async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);
  return profile?.githubAccessToken ?? undefined;
}
```

Or better, extract the helper from `github.ts` into a shared location so both files use the same function. Since Convex files can import from each other, adding an `internal` query or just duplicating the small helper is fine.

### 2. Update the Octokit creation in `generateResponse` to use the user's token

Replace the hardcoded env token:

```typescript
// Before (line 232):
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// After:
const userToken = await getUserGithubToken(ctx);
const octokit = new Octokit({ auth: userToken || process.env.GITHUB_TOKEN });
```

### 3. Run codegen and verify

- Run `npm -s convex codegen` if any new exports were added
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/ai.ts` | **Modify** | Add `getUserGithubToken` helper; update Octokit creation in `generateResponse` to use per-user token with env fallback |

## Acceptance Criteria

1. `convex/ai.ts` fetches the authenticated user's GitHub token via `getProfile`
2. The Octokit in `generateResponse` uses the user's token when available, falling back to `GITHUB_TOKEN`
3. Private repos that a user has access to (via their GitHub OAuth connection) will have their files available as AI context
4. When no user token is available (user hasn't connected GitHub), the fallback `GITHUB_TOKEN` env var is still used
5. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a one-line fix for the Octokit creation, plus adding the helper function
- The `ActionCtx` available in Convex actions supports auth, so `getProfile` will work correctly since it checks `getAuthUserId(ctx)` internally
- This task pairs with the GitHub OAuth connect flow — once users can connect GitHub, the AI needs to use their token to access private repo context
- No changes to the AI prompt, context selection, or streaming logic are needed
- The `getUserGithubToken` helper is small enough to duplicate in `ai.ts` rather than creating a shared module. Alternatively, it could be extracted to an internal query in `users.ts` that both files call.

## Completion Summary

### Changes Made
- **`convex/ai.ts`** — Modified:
  - Imported `ActionCtx` from `./_generated/server`
  - Added `getUserGithubToken(ctx: ActionCtx)` helper function (same pattern as `convex/github.ts`)
  - Updated Octokit creation in `generateResponse` from hardcoded `process.env.GITHUB_TOKEN` to `userToken || process.env.GITHUB_TOKEN`, where `userToken` is fetched via the new helper

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passed (zero errors)
- Browser test via playwright-cli — app builds and loads correctly on port 3847

### What This Fixes
The AI context-building step in `generateResponse` now uses the authenticated user's personal GitHub token (stored on their `userProfiles` record) when available, falling back to the global `GITHUB_TOKEN` env var. This means users who connect their GitHub account can have their private repos' files included as AI context.

## Review (00adcf52)

Reviewed `convex/ai.ts`:
- **TypeScript**: `tsc --noEmit` passes cleanly, `convex codegen` succeeds
- **`getUserGithubToken` helper**: Correctly duplicates the pattern from `convex/github.ts` — calls `api.users.getProfile` which uses `getAuthUserId` internally
- **Octokit creation** (line 238): `userToken || process.env.GITHUB_TOKEN` correctly prefers user token with env fallback
- **Import**: `ActionCtx` properly imported from `./_generated/server`
- **No side effects**: Change is minimal and isolated — only touches the Octokit auth line

No fixes needed.

## Review (c8012fc0)

Reviewed `convex/ai.ts`. `getUserGithubToken` helper is correct — calls `api.users.getProfile` and returns `githubAccessToken`. Octokit on line 238 properly uses `userToken || process.env.GITHUB_TOKEN`. TypeScript passes, codegen succeeds. No issues found, no fixes needed.
