# Epic: UX Polish & User Experience Improvements

## Overview

The PLAN.md states "UX is a major selling point of the platform" and that the "team member experience must be extremely non-tech friendly." This epic focuses on polishing the existing UI, improving error handling, adding proper loading states, and making the overall experience feel professional and complete.

## Progress

- [x] **Phase 1**: Invite acceptance flow — Create a dedicated `/invite/[code]` page so team members can accept invites via a shared link
- [x] **Phase 2**: Landing page polish — Improve the marketing/landing page with feature sections, screenshots, and better CTAs
- [ ] **Phase 3**: Empty states & onboarding — Add helpful empty states across the app (no repos, no sessions, no PRs, etc.)
- [ ] **Phase 4**: Toast & notification system improvements — Ensure consistent toast notifications across all actions
- [ ] **Phase 5**: Workspace UX — Improve the chat + preview workspace with better loading indicators, auto-resize panels, and keyboard shortcuts
- [ ] **Phase 6**: Mobile responsive improvements — Ensure dashboard and key pages work well on mobile/tablet
- [ ] **Phase 7**: Error boundary & recovery — Add React error boundaries, friendly error pages (404, 500), and connection loss handling

## Key Files

```
src/app/page.tsx                           # Landing page
src/app/(auth)/                            # Auth pages
src/app/(dashboard)/home/page.tsx          # Dashboard
src/app/workspace/[repoId]/page.tsx        # Main workspace
src/components/layout/                     # Layout components
src/components/ui/                         # UI primitives
```

## Success Criteria

- Non-technical users can navigate the entire app without confusion
- All actions provide clear feedback (loading, success, error states)
- Team invite flow works end-to-end via a simple link
- No dead-end screens or confusing empty states
