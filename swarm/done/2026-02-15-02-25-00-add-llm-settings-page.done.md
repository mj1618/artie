# Task: Add Custom LLM Provider Settings Page

## Context

The PLAN.md specifies that team owners can configure custom LLM API keys (OpenAI, Anthropic, Google) instead of using the platform default. The `teams` table in the schema does NOT yet have the `llmProvider`, `llmApiKey`, or `llmModel` fields — these need to be added. Currently `convex/ai.ts` hardcodes Anthropic with `process.env.ANTHROPIC_API_KEY`.

### What exists now:
- `convex/schema.ts` — `teams` table has `name` and `ownerId` only; no LLM fields
- `convex/ai.ts` — `generateResponse` action hardcodes Anthropic provider + API key from env
- `convex/teams.ts` — CRUD for teams, members, invites; `getTeam` query returns team with `myRole`
- `src/app/(dashboard)/home/page.tsx` — Dashboard with team list, each team has a "Manage" link
- `src/app/(dashboard)/team/[teamId]/page.tsx` — Team management page (members, invites, repo connection)
- No `src/app/(dashboard)/llm-settings/` page exists

## Requirements

### 1. Add LLM fields to `teams` table in schema (`convex/schema.ts`)

Add three optional fields to the `teams` table definition:

```typescript
teams: defineTable({
  name: v.string(),
  ownerId: v.string(),
  llmProvider: v.optional(v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google"))),
  llmApiKey: v.optional(v.string()),
  llmModel: v.optional(v.string()),
}).index("by_ownerId", ["ownerId"]),
```

### 2. Add backend mutations to `convex/teams.ts`

**`updateLlmSettings` mutation:**
- Args: `teamId`, optional `llmProvider`, optional `llmApiKey`, optional `llmModel`
- Auth check: only the team owner can update LLM settings
- Patches the team document with the provided fields
- If `llmProvider` is cleared (empty string or not provided), also clear `llmApiKey` and `llmModel`

**`getLlmSettings` query:**
- Args: `teamId`
- Auth check: only team owner can view
- Returns `{ llmProvider, llmModel, hasApiKey: boolean }` — NEVER return the actual API key to the frontend
- `hasApiKey` is `true` if `llmApiKey` is set and non-empty

```typescript
export const getLlmSettings = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) return null;
    return {
      llmProvider: team.llmProvider ?? null,
      llmModel: team.llmModel ?? null,
      hasApiKey: !!(team.llmApiKey && team.llmApiKey.length > 0),
    };
  },
});

export const updateLlmSettings = mutation({
  args: {
    teamId: v.id("teams"),
    llmProvider: v.optional(v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google"))),
    llmApiKey: v.optional(v.string()),
    llmModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    const updates: Record<string, unknown> = {};
    if (args.llmProvider !== undefined) updates.llmProvider = args.llmProvider || undefined;
    if (args.llmApiKey !== undefined) updates.llmApiKey = args.llmApiKey || undefined;
    if (args.llmModel !== undefined) updates.llmModel = args.llmModel || undefined;

    // If provider is being cleared, clear everything
    if (args.llmProvider === undefined || args.llmProvider === "") {
      updates.llmProvider = undefined;
      updates.llmApiKey = undefined;
      updates.llmModel = undefined;
    }

    await ctx.db.patch("teams", args.teamId, updates);
  },
});
```

### 3. Create LLM Settings page (`src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx`)

Place it under the team route (not a standalone `/llm-settings`) since LLM config is per-team:

**UI sections:**
- **Current Configuration** — Show current provider and model (or "Using platform default: Anthropic Claude")
- **Provider Selection** — Radio buttons or select for: Platform Default, OpenAI, Anthropic, Google
- **API Key** — Password input field. If `hasApiKey` is true, show "API key is set" with option to update. Never display the actual key.
- **Model Selection** — Text input or select with common models for the selected provider:
  - OpenAI: gpt-4, gpt-4-turbo, gpt-3.5-turbo
  - Anthropic: claude-sonnet-4-20250514, claude-3-haiku-20240307
  - Google: gemini-pro, gemini-1.5-pro
- **Save** button
- **Reset to Default** button (clears all LLM settings)

**Design:**
- Follow the existing zinc dark theme
- Use same layout as repo settings page (max-w-3xl, sections with dividers)
- Owner-only — show "Not authorized" for non-owners

### 4. Add navigation link

Add an "LLM Settings" link to the team management page (`src/app/(dashboard)/team/[teamId]/page.tsx`) — next to or below the existing team info, visible only to the owner.

### 5. Wire AI action to use team LLM config (`convex/ai.ts`)

Update `generateResponse` to:
1. Look up the session → repo → team to find the team's LLM config
2. If the team has a custom `llmProvider` and `llmApiKey`, use that provider
3. Otherwise, fall back to the platform default (Anthropic + `process.env.ANTHROPIC_API_KEY`)

This requires installing `@ai-sdk/openai` and `@ai-sdk/google`:
```bash
npm install @ai-sdk/openai @ai-sdk/google
```

Update the action to resolve the correct provider:
```typescript
// In generateResponse action handler:
const session = await ctx.runQuery(api.sessions.get, { sessionId: args.sessionId });
const repo = session ? await ctx.runQuery(api.projects.get, { repoId: session.repoId }) : null;
const team = repo ? await ctx.runQuery(internal.teams.getTeamInternal, { teamId: repo.teamId }) : null;

let model;
if (team?.llmProvider && team?.llmApiKey) {
  switch (team.llmProvider) {
    case "openai":
      const { createOpenAI } = await import("@ai-sdk/openai");
      model = createOpenAI({ apiKey: team.llmApiKey })(team.llmModel || "gpt-4");
      break;
    case "anthropic":
      model = createAnthropic({ apiKey: team.llmApiKey })(team.llmModel || "claude-sonnet-4-20250514");
      break;
    case "google":
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      model = createGoogleGenerativeAI({ apiKey: team.llmApiKey })(team.llmModel || "gemini-pro");
      break;
  }
} else {
  model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    "claude-sonnet-4-20250514"
  );
}
```

**Note:** You may need to add an `internalQuery` in `teams.ts` to fetch team data without auth checks (for server-side use in actions), and ensure `sessions.get` and `projects.get` return the necessary fields.

### 6. Run codegen and verify

- Run `npm -s convex codegen`
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `llmProvider`, `llmApiKey`, `llmModel` optional fields to `teams` table |
| `convex/teams.ts` | **Modify** | Add `getLlmSettings` query and `updateLlmSettings` mutation |
| `src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx` | **Create** | LLM settings page with provider/key/model config (owner-only) |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modify** | Add "LLM Settings" link for owners |
| `convex/ai.ts` | **Modify** | Wire multi-provider support using team LLM config |
| `package.json` | **Modify** | Add `@ai-sdk/openai` and `@ai-sdk/google` dependencies |

## Acceptance Criteria

1. `teams` table in schema has `llmProvider`, `llmApiKey`, `llmModel` optional fields
2. `getLlmSettings` query returns provider/model/hasApiKey without exposing the actual key
3. `updateLlmSettings` mutation is owner-only and patches team LLM config
4. LLM settings page renders with provider selection, API key input, model selection
5. "Reset to Default" clears all LLM fields
6. Team management page has a link to LLM settings (owner-only)
7. `convex/ai.ts` resolves the correct LLM provider based on team config
8. Falls back to platform default Anthropic when no custom config is set
9. `npm -s convex codegen` completes successfully
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- **Security**: Never return `llmApiKey` to the frontend. Only expose `hasApiKey: boolean`.
- The `teams` table uses `v.optional()` for all LLM fields so existing team documents don't need migration.
- Use `"use node"` directive in `convex/ai.ts` (already present) since it uses Node.js packages.
- Dynamic `import()` for `@ai-sdk/openai` and `@ai-sdk/google` is fine in `"use node"` actions, but static imports are preferred if the bundler supports it.
- The model strings should match what each provider expects (e.g., OpenAI uses "gpt-4", Anthropic uses "claude-sonnet-4-20250514").

---

## Completion Summary

### Files Modified
- **`convex/schema.ts`** — Added `llmProvider`, `llmApiKey`, `llmModel` optional fields to the `teams` table
- **`convex/teams.ts`** — Added `getLlmSettings` query (owner-only, never exposes API key), `updateLlmSettings` mutation (owner-only, clears all fields when provider is cleared), `getTeamInternal` internalQuery (for server-side use in actions)
- **`convex/ai.ts`** — Wired multi-provider support: resolves session → repo → team to find LLM config, supports OpenAI/Anthropic/Google via `@ai-sdk/*`, falls back to platform default Anthropic
- **`src/app/(dashboard)/team/[teamId]/page.tsx`** — Added "LLM Settings" navigation link in a new "Settings" section, visible only to team owners
- **`package.json` / `package-lock.json`** — Added `@ai-sdk/openai` and `@ai-sdk/google` dependencies

### Files Created
- **`src/app/(dashboard)/team/[teamId]/llm-settings/page.tsx`** — Full LLM settings page with:
  - Current configuration display (provider, model, API key status)
  - Provider selection (Platform Default, OpenAI, Anthropic, Google) via radio buttons
  - Password input for API key (never shows the actual key, placeholder indicates if set)
  - Model selection dropdown with provider-specific options
  - Save button and Reset to Default button
  - Owner-only access with "Not authorized" message for non-owners
  - Follows existing zinc dark theme and max-w-3xl layout pattern

### Verification
- `npx -s convex codegen` — Passed
- `npx -s tsc -p tsconfig.json --noEmit` — Passed with no errors
- `npm run build` — Succeeded, route `/team/[teamId]/llm-settings` appears as dynamic route
- Browser test — Login page renders correctly, auth redirect works for unauthenticated users

## Reviewer Notes (agent ccb8965e, iteration 2)

**Comprehensive codebase review** — reviewed all 38+ source files across frontend and backend.

### Verification
- `npx convex codegen` — passed
- `npx tsc -p tsconfig.json --noEmit` — passes clean (zero errors)

### Files reviewed (no issues found)

**Convex backend (11 files):** `ai.ts`, `auth.ts`, `auth.config.ts`, `github.ts`, `http.ts`, `messages.ts`, `projects.ts`, `schema.ts`, `sessions.ts`, `teams.ts`, `users.ts` — all correct with proper auth checks, schema consistency, and `"use node"` directives where needed.

**Frontend pages (12 files):** Landing page, auth pages (login/signup/layout), dashboard pages (home, settings, team management, LLM settings, repo settings), workspace page — all have correct `"use client"` directives, proper auth guards, loading/error/not-found states.

**Shared components (7 files):** Header, SplitPane, ChatPanel, MessageList, MessageBubble, PreviewPanel, ConvexClientProvider — all clean.

**WebContainer library (4 files):** Singleton boot, file utilities, project detection, React hook — all correct with proper `"use client"` and cancellation handling.

### Checks
- All `"use client"` directives present where needed
- All import paths correct (`@/` and relative)
- Schema fields/indexes consistent with all queries/mutations
- Auth guards on all protected routes
- `tsconfig.json` excludes `builds/` and `node_modules`

**No fixes needed.** Codebase is clean and correct.
