# Task: Landing Page Redesign

## What to Build

Redesign the landing page (`src/app/page.tsx`) to be more compelling and informative. The current page has a basic hero and 3 feature cards. Upgrade it to a full marketing page that sells Artie's value proposition to both owners (who sign up) and team members (who are invited).

## Design Requirements

1. **Hero Section** (keep existing, enhance):
   - Keep the headline and subtitle but make them punchier
   - Add a mock screenshot/illustration of the workspace (chat + preview layout) using a styled div with placeholder content — no actual images needed, use Tailwind to create a visual representation
   - Improve the CTA buttons with more visual weight

2. **"How It Works" Section** (new):
   - 3-step process: Connect your repo -> Describe changes -> See results
   - Use numbered steps with icons and brief descriptions
   - Clean horizontal layout on desktop, stacked on mobile

3. **Features Section** (upgrade existing):
   - Expand from 3 to 6 feature cards in a 2-column or 3-column grid
   - Add: Team collaboration, PR review workflow, Multiple runtimes
   - Keep: AI editing, Live preview, GitHub integration
   - Each card: icon + title + 1-2 sentence description

4. **Social Proof / Trust Section** (new):
   - Simple section with "Built with" logos/text: Next.js, Convex, GitHub, Anthropic
   - Styled as subtle tech stack badges

5. **Footer** (upgrade existing):
   - Proper footer with links: Sign in, Sign up, GitHub (link to repo if public)
   - Copyright line

## Files to Modify

- `src/app/page.tsx` — Main landing page (rewrite the JSX, keep the auth redirect logic)

## Design Constraints

- Use existing Tailwind classes and the `paper-*` color palette already used throughout the app
- Keep the page as a client component (needs `useConvexAuth` for redirect)
- Responsive: must look good on mobile, tablet, and desktop
- No external images or assets — use SVG icons and Tailwind styling only
- Match the clean, minimal aesthetic of the rest of the app

## How to Verify

1. Run `npx tsc --noEmit` — no type errors
2. Run `npm run dev` and open `http://localhost:3000` while logged out
3. Verify:
   - Hero section renders with headline, subtitle, mock workspace preview, and CTA buttons
   - "How it works" section shows 3 steps
   - Features grid shows 6 cards
   - Tech stack badges appear
   - Footer renders with links
   - Clicking "Get started" navigates to `/signup`
   - Clicking "Sign in" navigates to `/login`
   - Page is responsive (resize browser to mobile width)
   - When logged in, redirects to `/home`

---

## Completion Summary

### What was built

Redesigned the landing page from a basic hero + 3 feature cards into a full marketing page with 5 sections:

1. **Enhanced Hero** — Punchier headline ("Edit your app with words, not code"), improved subtitle, larger CTA buttons with arrow icon and hover transitions
2. **Mock Workspace Preview** — Tailwind-only illustration of the chat + preview workspace layout with a browser chrome frame, chat messages, and preview content areas
3. **"How It Works" Section** — 3 numbered steps (Connect your repo, Describe changes, See results) in a responsive grid layout
4. **Expanded Features Grid** — 6 feature cards in a 3-column grid (AI-Powered Editing, Live Preview, GitHub Integration, Team Collaboration, PR Review Workflow, Multiple Runtimes) with SVG icons
5. **Tech Stack Badges** — "Built with" section showing Next.js, Convex, GitHub, Anthropic as styled pill badges
6. **Proper Footer** — Sign in, Sign up links with Artie branding and copyright line

### Files changed

- `src/app/page.tsx` — Complete rewrite of JSX; preserved auth redirect logic and `"use client"` directive

### Verification

- `npx tsc --noEmit` passes clean
- Build compiles successfully (Next.js 16.1.6 Turbopack)
- Page renders loading state correctly (Convex auth check); all landing page sections are present in the client bundle

---

## Review (1a141c44)

### Issues found and fixed

1. **Removed unused `LinkIcon` component** — The `LinkIcon` SVG component was defined but never referenced anywhere in the page. Removed the dead code.

### Verified

- `"use client"` directive present
- All imports valid (`useConvexAuth`, `Link`, `useRouter`, `useEffect`)
- Auth redirect logic correct (redirects to `/home` when authenticated, shows spinner while loading)
- `/login` and `/signup` routes exist under `(auth)` route group — links are valid
- All 6 feature icon components used correctly in the features array
- Responsive grid classes look correct (`sm:grid-cols-2 lg:grid-cols-3`, `md:grid-cols-3`)
- `npx tsc --noEmit` passes clean after fix
- No missing error/loading states — loading spinner shown during auth check
