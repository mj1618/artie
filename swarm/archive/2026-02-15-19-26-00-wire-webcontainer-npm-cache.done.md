# Task: Wire IndexedDB Cache Into WebContainer Boot to Skip npm install

## Context

The `npm install` step is the slowest part of booting a WebContainer — typically 30-60 seconds. A cache module (`src/lib/webcontainer/cache.ts`) already exists that stores and retrieves `FileSystemTree` snapshots in IndexedDB, keyed by a hash of the lockfile/package.json. However, **it's not wired into the boot process.**

Currently, every time a user opens a workspace (or switches branches), the full boot cycle runs: boot → fetch files → mount → `npm install` → start dev server. For returning users on the same repo with unchanged dependencies, `npm install` is completely redundant.

### What exists now:
- `src/lib/webcontainer/cache.ts` — Full IndexedDB cache implementation with `generateCacheKey()`, `getCachedSnapshot()`, `setCachedSnapshot()`, `clearCache()`. Not imported anywhere.
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Boot flow: `getWebContainer()` → `fetchRepoFiles()` → `loadFiles()` → `startDevServer()` (which runs `npm install` + starts dev server).
- `src/lib/webcontainer/devServer.ts` — `startDevServer()` runs `npm install` then starts the appropriate dev server command. The install step is baked into this function.

### What's missing:
- No code reads from the cache before mounting files
- No code writes to the cache after `npm install` completes
- `startDevServer()` always runs `npm install` — there's no way to skip it
- The cache key generation uses the file tree from GitHub, which is available at the right time

## Requirements

### 1. Add a `skipInstall` option to `startDevServer()` in `src/lib/webcontainer/devServer.ts`

Add an optional parameter that lets the caller skip `npm install` when using a cached snapshot:

```typescript
export async function startDevServer(
  container: WebContainer,
  onStatus: (state: Partial<DevServerState>) => void,
  options?: { skipInstall?: boolean },
): Promise<void> {
  const output: string[] = [];
  const projectType = await detectProjectType(container);

  if (!options?.skipInstall) {
    onStatus({ status: "installing", output: ["Installing dependencies..."] });
    const installProcess = await container.spawn("npm", ["install"]);
    // ... existing install logic
  } else {
    output.push("Using cached dependencies, skipping install.");
    onStatus({ status: "installing", output: [...output] });
  }

  // ... rest of dev server start unchanged
}
```

### 2. Wire cache into `boot()` in `src/lib/webcontainer/useWorkspaceContainer.ts`

Import the cache functions and use them in the boot flow:

```typescript
import {
  generateCacheKey,
  getCachedSnapshot,
  setCachedSnapshot,
} from "./cache";
```

In the `boot()` function, after fetching repo files but before mounting:

```typescript
const boot = useCallback(async () => {
  if (startedRef.current) return;
  startedRef.current = true;
  bootedBranchRef.current = options?.branch;

  try {
    setState((s) => ({ ...s, phase: "booting", error: null }));
    const container = await getWebContainer();
    containerRef.current = container;

    setState((s) => ({ ...s, phase: "fetching" }));
    const fileTree = await fetchRepoFiles({ repoId, branch: options?.branch });
    const fileTreeTyped = fileTree as FileSystemTree;

    // Check cache for node_modules snapshot
    const cacheKey = await generateCacheKey(String(repoId), fileTreeTyped);
    const cachedSnapshot = await getCachedSnapshot(cacheKey);

    setState((s) => ({ ...s, phase: "mounting" }));
    await loadFiles(container, fileTreeTyped);

    // If we have a cached snapshot, mount node_modules from cache
    if (cachedSnapshot) {
      await loadFiles(container, cachedSnapshot);
    }

    await startDevServer(
      container,
      (devState: Partial<DevServerState>) => {
        setState((s) => ({
          ...s,
          phase: (devState.status as ContainerPhase) ?? s.phase,
          previewUrl: devState.url ?? s.previewUrl,
          error: devState.error ?? s.error,
          output: devState.output ?? s.output,
        }));
      },
      { skipInstall: !!cachedSnapshot },
    );

    // If we didn't have a cache hit, save node_modules snapshot after install
    if (!cachedSnapshot) {
      try {
        const nodeModulesSnapshot = await snapshotNodeModules(container);
        if (nodeModulesSnapshot) {
          await setCachedSnapshot(cacheKey, nodeModulesSnapshot);
        }
      } catch (err) {
        // Caching is best-effort — don't fail the boot
        console.warn("Failed to cache node_modules:", err);
      }
    }
  } catch (err) {
    setState((s) => ({
      ...s,
      phase: "error",
      error: err instanceof Error ? err.message : "Failed to start preview",
    }));
  }
}, [repoId, fetchRepoFiles, options?.branch]);
```

### 3. Add `snapshotNodeModules()` helper to `src/lib/webcontainer/files.ts` (or cache.ts)

WebContainer `fs.readdir` doesn't support recursively reading `node_modules` into a `FileSystemTree` efficiently. Instead of snapshotting `node_modules`, the cache should store the **full mounted filesystem snapshot** (which the cache module is already designed for — it stores `FileSystemTree`).

Actually, a simpler approach: since node_modules is too large to snapshot, **cache the lockfile hash and just check if npm install is needed**. If the lockfile hash matches, run `npm install` but it will be a no-op (fast). This is still faster than a clean install.

**Even simpler approach:** Skip the snapshot entirely. Just use the cache key (lockfile hash) to track whether we've already installed on this container. If the container was torn down and rebooted, npm install always needs to run again (fresh container). The cache is only useful across page reloads within the same browser — and WebContainer doesn't persist across page reloads anyway.

**Revised approach:** The real win is caching the `FileSystemTree` (repo files) to avoid the GitHub API fetch on revisit. The `npm install` must run every time since WebContainer instances don't persist. But fetching repo files from GitHub can be slow too (5-15 seconds for large repos).

Update the approach:

```typescript
// In boot():
setState((s) => ({ ...s, phase: "fetching" }));

// Try cache first
const cacheKey = `${repoId}:${options?.branch ?? "default"}`;
let fileTreeTyped: FileSystemTree;
const cachedTree = await getCachedSnapshot(cacheKey);

if (cachedTree) {
  fileTreeTyped = cachedTree;
} else {
  const fileTree = await fetchRepoFiles({ repoId, branch: options?.branch });
  fileTreeTyped = fileTree as FileSystemTree;
  // Cache for next time (best-effort)
  setCachedSnapshot(cacheKey, fileTreeTyped).catch(() => {});
}

setState((s) => ({ ...s, phase: "mounting" }));
await loadFiles(container, fileTreeTyped);
// ... continue with startDevServer as normal
```

Wait — this changes the semantics. If we cache the file tree, the user won't see the latest changes from GitHub. We need to balance freshness vs speed.

**Final approach — background refresh with stale cache:**

1. On boot, check if there's a cached file tree for this repo+branch
2. If cached, use it immediately for fast boot
3. In the background, fetch fresh files from GitHub
4. If fresh files differ from cache, update the cache (and optionally notify the user)
5. If no cache, fetch from GitHub normally

This is similar to stale-while-revalidate:

```typescript
// In boot():
setState((s) => ({ ...s, phase: "fetching" }));

const cacheKey = `${repoId}:${options?.branch ?? "default"}`;
const cachedTree = await getCachedSnapshot(cacheKey);

let fileTreeTyped: FileSystemTree;

if (cachedTree) {
  // Use cache for fast boot
  fileTreeTyped = cachedTree;
  // Background refresh: fetch fresh files and update cache
  fetchRepoFiles({ repoId, branch: options?.branch })
    .then((freshTree) => {
      setCachedSnapshot(cacheKey, freshTree as FileSystemTree).catch(() => {});
    })
    .catch(() => {});
} else {
  // No cache — must fetch
  const fileTree = await fetchRepoFiles({ repoId, branch: options?.branch });
  fileTreeTyped = fileTree as FileSystemTree;
  setCachedSnapshot(cacheKey, fileTreeTyped).catch(() => {});
}
```

This gives the best UX: instant boot on revisit, with fresh data cached for next time.

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/webcontainer/useWorkspaceContainer.ts` | **Modify** | Import cache functions. In `boot()`, check IndexedDB cache before fetching from GitHub. Write to cache after successful fetch. |
| `src/lib/webcontainer/cache.ts` | **No changes** | Already has all needed functions (`generateCacheKey`, `getCachedSnapshot`, `setCachedSnapshot`). However, the key generation uses lockfile hashing — for caching the file tree itself, we should use a simpler repo+branch key. Add a `repoTreeKey(repoId, branch)` helper if needed, or just use the simpler string key inline. |

## Acceptance Criteria

1. First visit to a repo workspace: files fetched from GitHub, cached to IndexedDB, boot proceeds normally
2. Subsequent visits to the same repo+branch: files loaded from IndexedDB cache instantly (skipping GitHub API call), boot proceeds faster
3. Background refresh updates the cache so the next visit gets fresh files
4. Cache miss (first visit, cleared cache) falls back to GitHub fetch gracefully
5. IndexedDB errors are caught and don't break the boot flow (best-effort caching)
6. Different branches have separate cache entries (`repoId:main` vs `repoId:feature/hero`)
7. The `refreshFiles()` function still fetches from GitHub (not cache) since it's explicitly requesting fresh data
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- The existing `generateCacheKey()` function in `cache.ts` hashes the lockfile — this is good for npm install caching but overkill for file tree caching. For file tree caching, a simple `repoId:branch` key is sufficient.
- IndexedDB has a ~500MB storage limit per origin. File trees for typical repos are 1-10MB. This is well within limits for caching several repos.
- The stale-while-revalidate pattern means users see slightly stale files on boot but the preview loads much faster. Since most revisits are to continue working (not to see others' changes), this tradeoff is acceptable.
- The `refreshFiles()` function (pull from GitHub button) always fetches fresh and should also update the cache.
- WebContainer instances don't persist across page reloads, so `npm install` must still run every time. The cache only helps with the GitHub API fetch.

---

## Implementation Summary

### What was built

Wired the existing IndexedDB cache module into the WebContainer boot flow using a stale-while-revalidate pattern. On first visit, files are fetched from GitHub and cached to IndexedDB. On subsequent visits to the same repo+branch, the cached file tree is used immediately for fast boot, while a background fetch updates the cache for next time. The `refreshFiles()` function also updates the cache when pulling fresh files.

### Files changed

| File | Change |
|------|--------|
| `src/lib/webcontainer/useWorkspaceContainer.ts` | Imported `getCachedSnapshot` and `setCachedSnapshot` from cache module. Updated `boot()` to check IndexedDB cache before fetching from GitHub (stale-while-revalidate). Updated `refreshFiles()` to write fresh files to cache after GitHub fetch. |

### Key design decisions

- Used simple `repoId:branch` cache key (not the lockfile-hash-based `generateCacheKey`) since we're caching the full file tree, not node_modules.
- Did not add `skipInstall` to `startDevServer()` — WebContainer instances don't persist across page reloads, so `npm install` must run every time regardless.
- All cache operations are best-effort with `.catch(() => {})` to prevent IndexedDB errors from breaking the boot flow.
- Background refresh ensures the cache stays fresh for the next visit without slowing down the current boot.

## Review (63350802)

### Files Reviewed
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Cache integration via stale-while-revalidate pattern, import correctness, error handling
- `src/lib/webcontainer/cache.ts` — IndexedDB cache module, exported API surface
- `src/lib/webcontainer/devServer.ts` — Verified `startDevServer` signature unchanged (no `skipInstall` added, correctly per task decision)
- `src/lib/webcontainer/files.ts` — Verified `loadFiles` and `removePathsFromTree` unchanged
- `src/lib/webcontainer/index.ts` — Verified singleton lifecycle (`getWebContainer`, `teardownWebContainer`)
- `src/components/preview/PreviewPanel.tsx` — Verified hook integration passes branch correctly

### Verification
- `npx tsc --noEmit` passes with no errors

### No Issues Found
- Cache key format `${repoId}:${branch ?? "default"}` is appropriate for file tree caching
- Stale-while-revalidate is correctly implemented: cached tree for immediate boot, background GitHub fetch updates cache
- All cache operations wrapped in `.catch(() => {})` — IndexedDB failures are non-fatal
- `refreshFiles()` correctly updates cache with fresh files after GitHub pull
- `generateCacheKey` (lockfile-hash-based) is intentionally unused — simple string key is the right choice for file tree caching
- No fixes needed
