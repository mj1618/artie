# Task: Add Runtime Selection to Repo Settings Page

## Context

The `repos` table already has a `runtime` field (`"webcontainer" | "flyio-sprite"`) and the `updateRepo` mutation already accepts it. However, the repo settings page (`src/app/(dashboard)/repos/[repoId]/settings/page.tsx`) has no UI for changing the runtime — it only shows push strategy and default branch.

This task adds a runtime selection radio group to the existing repo settings form, wires it into the save flow, and shows the current runtime in the information section.

### What exists now:
- `convex/schema.ts` — `repos` table has `runtime: v.optional(...)` field
- `convex/projects.ts` — `updateRepo` mutation already accepts `runtime` arg (line 102)
- `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` — Settings page with push strategy radios and default branch input, but no runtime selection

### What's missing:
- Runtime radio group in the Configuration section (between push strategy and default branch)
- Runtime included in the `hasChanges` check and `handleSave` call
- Current runtime shown in the Information section

## Requirements

### 1. Add runtime state and change detection

Add state for runtime selection alongside the existing `pushStrategy` and `defaultBranch` state:

```typescript
const [runtime, setRuntime] = useState<"webcontainer" | "flyio-sprite" | null>(null);
```

Update `currentRuntime` to derive from state or repo data (defaulting to `"webcontainer"` when repo.runtime is undefined):

```typescript
const currentRuntime = runtime ?? repo.runtime ?? "webcontainer";
```

Update `hasChanges` to include runtime:

```typescript
const hasChanges =
  currentPushStrategy !== repo.pushStrategy ||
  currentDefaultBranch !== repo.defaultBranch ||
  currentRuntime !== (repo.runtime ?? "webcontainer");
```

### 2. Add runtime radio group to the Configuration form

Add a radio group between the push strategy and default branch sections. Use the same styling pattern as push strategy:

```tsx
<div>
  <label className="block text-sm font-medium text-zinc-300">
    Runtime Environment
  </label>
  <p className="mt-0.5 text-xs text-zinc-500">
    Choose how code is executed for live previews
  </p>
  <div className="mt-2 flex gap-4">
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <input
        type="radio"
        name="runtime"
        value="webcontainer"
        checked={currentRuntime === "webcontainer"}
        onChange={() => setRuntime("webcontainer")}
        className="accent-zinc-100"
      />
      WebContainer (browser)
    </label>
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <input
        type="radio"
        name="runtime"
        value="flyio-sprite"
        checked={currentRuntime === "flyio-sprite"}
        onChange={() => setRuntime("flyio-sprite")}
        className="accent-zinc-100"
      />
      Fly.io Sprite (server)
    </label>
  </div>
</div>
```

### 3. Wire runtime into save handler

Update the `handleSave` function to include `runtime` in the `updateRepo` call:

```typescript
await updateRepo({
  repoId,
  pushStrategy: currentPushStrategy,
  defaultBranch: currentDefaultBranch,
  runtime: currentRuntime,
});
```

Reset the runtime state after save:

```typescript
setRuntime(null);
```

### 4. Show current runtime in the Information section

Add a row to the Information `<dl>` showing the current runtime:

```tsx
<div className="flex items-center justify-between px-4 py-3">
  <dt className="text-sm text-zinc-400">Runtime</dt>
  <dd className="text-sm font-medium text-zinc-200">
    {(repo.runtime ?? "webcontainer") === "webcontainer"
      ? "WebContainer (browser)"
      : "Fly.io Sprite (server)"}
  </dd>
</div>
```

### 5. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | **Modify** | Add runtime radio group to Configuration form, include runtime in save flow, show runtime in Information section |

## Acceptance Criteria

1. Repo settings page shows a "Runtime Environment" radio group with WebContainer and Fly.io Sprite options
2. The current runtime is pre-selected (defaulting to WebContainer if unset)
3. Changing the runtime and clicking Save updates the repo's runtime field
4. The "Save Changes" button is enabled when runtime is changed
5. The Information section shows the current runtime
6. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Only one file needs to change — this is purely a frontend UI addition
- The backend mutation already handles runtime updates (convex/projects.ts line 102-114)
- Default to `"webcontainer"` when `repo.runtime` is undefined to match existing behavior
- Follow the exact same radio button pattern used for push strategy to maintain visual consistency
- No need to add any Fly.io validation or checks — that's a separate task. This is just persisting the user's choice.

## Completion Summary

### Files Changed
| File | Changes |
|------|---------|
| `src/app/(dashboard)/repos/[repoId]/settings/page.tsx` | Added runtime state, radio group UI, save logic, and info display |

### What Was Built
- Added `runtime` state (`useState<"webcontainer" | "flyio-sprite" | null>`) for tracking user selection
- Added `currentRuntime` derived value with fallback to `"webcontainer"`
- Updated `hasChanges` to detect runtime changes
- Added "Runtime Environment" radio group in Configuration section (between Push Strategy and Default Branch)
- Wired `runtime` into `handleSave` → `updateRepo` mutation call
- Added runtime reset (`setRuntime(null)`) after successful save
- Added "Runtime" row to Information `<dl>` section showing current runtime

### Verification
- TypeScript check (`npx tsc -p tsconfig.json --noEmit`) passes with no errors
- Browser tested: Information section shows "Runtime: WebContainer (browser)", Configuration shows radio group, selecting "Fly.io Sprite (server)" enables Save button

### Reviewer Notes (agent 22f00c9f)
- **Runtime selection settings page**: Code is clean. No issues found — proper `"use client"` directive, correct imports, correct state management, proper change detection, proper save flow with runtime included.
- **Fixed: deploy-keys page import paths** (`src/app/(dashboard)/team/[teamId]/deploy-keys/page.tsx`): Changed `@/convex/_generated/api` and `@/convex/_generated/dataModel` to relative paths (`../../../../../../convex/_generated/api` etc.) since the `@/` alias maps to `./src/*` and the convex directory is at project root. This fixed 3 TypeScript errors (2 module-not-found + 1 cascading implicit `any`).
- TypeScript check passes clean after fix.
