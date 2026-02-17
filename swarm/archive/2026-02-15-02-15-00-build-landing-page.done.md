# Task: Build Landing Page for Unauthenticated Visitors

## Context

The original `src/app/page.tsx` was deleted during earlier work. Currently, the root route `/` is handled by the `(dashboard)` route group which redirects unauthenticated users to `/login`. There's no landing or marketing page — visitors go straight to a login form with no context about what Artie does.

The PLAN.md lists a "Landing Page: Hero, features, CTA to sign up" as a key screen. This task creates that page.

### What exists now:
- `src/app/layout.tsx` — Root layout with ConvexClientProvider, Geist fonts
- `src/app/(auth)/login/page.tsx` — Login page
- `src/app/(auth)/signup/page.tsx` — Signup page
- `src/app/(dashboard)/page.tsx` — Dashboard (authenticated users only, at `/`)
- No `src/app/page.tsx` — the root page is missing

### The problem:
The `(dashboard)` route group handles `/` for authenticated users. For unauthenticated visitors, they get redirected to `/login`. We need a proper landing page that:
1. Shows what Artie is
2. Provides clear CTAs to sign up or log in
3. Lives at a route that doesn't conflict with the dashboard

## Requirements

### 1. Create `src/app/page.tsx` — Root Landing Page

This page should be a **client component** that:
- Checks auth state using `useConvexAuth()`
- If authenticated, redirects to the dashboard (using the `(dashboard)` route)
- If not authenticated, shows the landing page content

**Landing page content:**
- **Hero section**: Large heading "Build with AI, preview instantly", subheading explaining Artie helps non-technical users modify web apps using natural language
- **Features section** (3 cards):
  1. "AI-Powered Editing" — Describe changes in plain English, AI builds them
  2. "Live Preview" — See changes instantly in a real browser preview
  3. "GitHub Integration" — Changes sync directly to your repository
- **CTA section**: "Get started" button → `/signup`, "Already have an account?" link → `/login`

**Design:**
- Use the existing zinc dark theme (bg-zinc-950, text-zinc-100, etc.)
- Keep it clean and minimal
- Use Geist font (already configured in layout)
- Make it responsive

### 2. Handle the routing conflict

The `(dashboard)/page.tsx` currently serves `/`. The new `src/app/page.tsx` will take priority over the route group for the root `/` path. This means:
- The landing page at `src/app/page.tsx` handles `/` for everyone
- If authenticated, it redirects to `/dashboard`
- Move `src/app/(dashboard)/page.tsx` to `src/app/(dashboard)/dashboard/page.tsx` so it's at `/dashboard`

**OR** (simpler approach):
- Keep `(dashboard)/page.tsx` as-is at `/` route
- Create the landing page at `src/app/page.tsx` which checks auth:
  - Authenticated → render dashboard content directly (or re-export)
  - Not authenticated → render landing page

The simplest approach: Create `src/app/page.tsx` that checks auth. If authenticated, redirect to dashboard. If not, show landing content. Since `(dashboard)/page.tsx` currently handles `/` as well, we need to be careful about route conflicts.

**Recommended approach:**
1. Create `src/app/(landing)/page.tsx` as the landing page (route group won't add path segment)
2. Wait — that would conflict too.

**Cleanest solution:**
1. Rename `src/app/(dashboard)/page.tsx` → `src/app/(dashboard)/home/page.tsx` (dashboard now lives at `/home`)
2. Update all links that point to `/` for the dashboard to point to `/home` instead
3. Create `src/app/page.tsx` as the landing page that redirects authenticated users to `/home`

**Files to update with new dashboard path:**
- `src/app/(dashboard)/layout.tsx` — redirect target (login redirect stays `/login`)
- `src/components/layout/Header.tsx` — any dashboard links
- `src/app/(auth)/login/page.tsx` — redirect after login
- `src/app/(auth)/signup/page.tsx` — redirect after signup
- Any other links to `/` that mean "go to dashboard"

### 3. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/page.tsx` | **Create** | Landing page with hero, features, and CTA for unauthenticated users; redirect for authenticated users |
| `src/app/(dashboard)/page.tsx` | **Modify or Move** | May need to move to `/home` to avoid route conflict |
| `src/app/(auth)/login/page.tsx` | **Modify** | Update post-login redirect if dashboard path changes |
| `src/app/(auth)/signup/page.tsx` | **Modify** | Update post-signup redirect if dashboard path changes |
| `src/components/layout/Header.tsx` | **Modify** | Update dashboard link if path changes |

## Acceptance Criteria

1. Visiting `/` while not logged in shows a landing page with hero text, feature cards, and sign-up/login CTAs
2. Visiting `/` while logged in redirects to the dashboard
3. The landing page matches the zinc dark theme used throughout the app
4. The "Get Started" button navigates to `/signup`
5. The "Log in" link navigates to `/login`
6. The dashboard is still accessible for authenticated users
7. All existing links between auth pages and dashboard still work
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useConvexAuth()` from `convex/react` to check authentication state
- Use `useRouter()` from `next/navigation` for client-side redirects
- The landing page should feel polished — this is the first thing new users see
- Keep the page self-contained (no external images or assets needed)
- Follow the existing zinc dark theme: bg-zinc-950, borders zinc-800, text zinc-100/200/400/500
- Consider a subtle gradient or accent color to make the hero stand out

---

## Completion Summary

### What was built
Landing page for unauthenticated visitors at `/` with hero section, three feature cards (AI-Powered Editing, Live Preview, GitHub Integration), and CTAs linking to `/signup` and `/login`. Authenticated users are redirected to `/home`.

### Approach
Used the "cleanest solution" from the task: moved the dashboard from `/` to `/home` and created a new landing page at the root.

### Files changed
| File | Action | Notes |
|------|--------|-------|
| `src/app/page.tsx` | **Created** | Landing page with auth check, hero, features, footer CTA |
| `src/app/(dashboard)/page.tsx` → `src/app/(dashboard)/home/page.tsx` | **Moved** | Dashboard now lives at `/home` |
| `src/app/(dashboard)/home/page.tsx` | **Modified** | Fixed relative import paths after move |
| `src/app/(auth)/login/page.tsx` | **Modified** | Post-login redirect changed from `/` to `/home` |
| `src/app/(auth)/signup/page.tsx` | **Modified** | Post-signup redirect changed from `/` to `/home` |
| `src/components/layout/Header.tsx` | **Modified** | "Artie" logo link changed from `/` to `/home` |
| `src/app/(dashboard)/team/[teamId]/page.tsx` | **Modified** | "Back to dashboard" links changed from `/` to `/home` |
| `src/app/workspace/[repoId]/page.tsx` | **Modified** | "Back to dashboard" link changed from `/` to `/home` |
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | **Modified** | Fixed broken `@/convex/` imports (pre-existing issue from another agent) |

### Verification
- TypeScript check (`tsc --noEmit`) passes
- Next.js production build succeeds
- Browser testing confirms: landing page renders with hero, features, CTAs; navigation to `/signup` and `/login` works correctly

---

## Reviewer Notes (agent 5f2623db)

**Reviewed all 8 files** changed in this task. No issues found:

- `src/app/page.tsx` — Has `"use client"`, correct `useConvexAuth()` + `useRouter()` usage, proper loading/redirect states
- `src/app/(dashboard)/home/page.tsx` — Correctly moved, imports resolve, dashboard logic intact
- Auth pages (`login`, `signup`) — Both redirect to `/home` post-auth, consistent
- `Header.tsx` — Logo links to `/home`
- `team/[teamId]/page.tsx`, `workspace/[repoId]/page.tsx`, `repos/[repoId]/settings/page.tsx` — All "back to dashboard" links updated to `/home`
- No stale references to `/` as a dashboard route remain in the codebase
- `tsc --noEmit` passes with zero errors

**No fixes needed.** Code is clean and correct.
