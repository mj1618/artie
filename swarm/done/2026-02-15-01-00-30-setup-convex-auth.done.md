# Task: Set Up Convex Auth with Username/Password

## Context

The application currently runs in demo mode — a fake session is auto-created on page load with no authentication. The plan's Phase 1 includes "Implement Convex Auth (username/password)" as a foundational requirement. All subsequent features (team management, repo connection, invites) depend on having real user authentication.

This task sets up the Convex Auth backend and wires the provider into the frontend. It does NOT build login/signup UI pages — that's a separate follow-up task.

### What exists now:
- `convex/schema.ts` — has `userProfiles`, `teams`, `teamMembers`, `invites`, `repos`, `sessions`, `messages` tables
- `src/components/ConvexClientProvider.tsx` — wraps app with `ConvexProvider`
- `src/app/layout.tsx` — uses `ConvexClientProvider`
- No `@convex-dev/auth` package installed
- No `convex/auth.ts` or `convex/auth.config.ts` files exist

## Requirements

### 1. Install `@convex-dev/auth` package

```bash
npm install @convex-dev/auth
```

### 2. Create `convex/auth.ts` — Auth configuration

Set up Convex Auth with the Password provider for username/password authentication:

```typescript
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Password],
});
```

### 3. Create `convex/auth.config.ts` — Auth config for Convex

```typescript
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
```

### 4. Update `convex/schema.ts` — Add auth tables

Import `authTables` from `@convex-dev/auth/server` and spread them into the schema definition. The auth tables (`users`, `authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits`) must be included alongside the existing application tables.

```typescript
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  // ... existing tables remain unchanged
});
```

### 5. Update `convex/http.ts` — Add auth HTTP routes

Create `convex/http.ts` to register the auth HTTP endpoints:

```typescript
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
```

### 6. Update `src/components/ConvexClientProvider.tsx` — Use ConvexAuthProvider

Replace the basic `ConvexProvider` with `ConvexAuthProvider` from `@convex-dev/auth/react`:

```typescript
"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
```

### 7. Run codegen and verify

- Run `npm -s convex codegen` to generate types for new auth functions
- Run `npx tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `package.json` | **Modify** | Add `@convex-dev/auth` dependency (via npm install) |
| `convex/auth.ts` | **Create** | Auth configuration with Password provider |
| `convex/auth.config.ts` | **Create** | Auth config for Convex deployment |
| `convex/schema.ts` | **Modify** | Add `authTables` spread to schema |
| `convex/http.ts` | **Create** | HTTP router with auth routes |
| `src/components/ConvexClientProvider.tsx` | **Modify** | Switch to `ConvexAuthProvider` |

## Acceptance Criteria

1. `@convex-dev/auth` is installed in `package.json`
2. `convex/auth.ts` exports `auth`, `signIn`, `signOut`, `store` from `convexAuth` with Password provider
3. `convex/auth.config.ts` exists with proper configuration
4. `convex/schema.ts` includes `authTables` alongside existing tables
5. `convex/http.ts` registers auth HTTP routes
6. `ConvexClientProvider` uses `ConvexAuthProvider` instead of basic `ConvexProvider`
7. `npm -s convex codegen` completes successfully
8. `npx tsc -p tsconfig.json --noEmit` passes with no errors
9. No existing functionality is broken — the app should still load and the demo session should still work (though it won't have real auth yet)

## Tech Notes

- The `@convex-dev/auth` package provides a complete auth solution for Convex with built-in session management, token handling, and HTTP endpoints.
- The `Password` provider handles username/password signup and login flows.
- `authTables` adds several tables to the schema (`users`, `authAccounts`, `authSessions`, etc.) that are managed by the auth library.
- The existing `userProfiles` table is separate from the auth `users` table — `userProfiles.userId` will reference `Id<"users">` from the auth-managed users table.
- `ConvexAuthProvider` extends the basic Convex provider with auth context (current user, sign in/out functions).
- The `convex/http.ts` file is required for auth to work — it handles the OAuth/auth HTTP callbacks.
- After this task, the app will have auth infrastructure but no UI to use it. A follow-up task will create login/signup pages.
- The existing demo session flow will continue to work since it doesn't require authentication — but once login/signup pages are built, the flow will change to require auth first.

---

## Completion Summary

### What was built
Set up Convex Auth infrastructure with username/password (Password provider). This provides the backend auth system — a follow-up task will build the login/signup UI.

### Files created
- `convex/auth.ts` — Auth configuration exporting `auth`, `signIn`, `signOut`, `store`, `isAuthenticated` via `convexAuth` with Password provider
- `convex/auth.config.ts` — Auth config pointing to `CONVEX_SITE_URL`
- `convex/http.ts` — HTTP router registering auth HTTP endpoints

### Files modified
- `package.json` / `package-lock.json` — Added `@convex-dev/auth` dependency (and transitive deps including `lucia`, `@auth/core`, etc.)
- `convex/schema.ts` — Added `authTables` spread (adds `users`, `authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits` tables)
- `src/components/ConvexClientProvider.tsx` — Switched from `ConvexProvider` to `ConvexAuthProvider`

### Verification
- `npx convex codegen` completed successfully
- `npx tsc -p tsconfig.json --noEmit` passed with no errors
- Browser test confirmed the app still loads at localhost:3000 (page title "Artie", UI renders correctly)
- Pre-existing console error about `sessions:createDemo` is unrelated to auth changes
