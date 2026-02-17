# Task: Wire WebContainer Live Preview in Workspace

## Context

Three prerequisite tasks are currently in progress:
1. **WebContainer boot** — Creates `src/lib/webcontainer/` with boot singleton, file utilities, project detection, and `useWebContainer` hook
2. **GitHub actions backend** — Creates `convex/github.ts` with `fetchRepoForWebContainer` action that returns a WebContainer-compatible `FileSystemTree`
3. **LLM settings page** — Adds custom LLM provider config (independent, not blocking this task)

Once tasks #1 and #2 land, all the pieces exist to show a real live preview. But nothing currently connects them — the workspace page still uses `srcDoc` iframes rendering static HTML from the AI chat. This task wires everything together so the workspace:

1. Boots a WebContainer on page load
2. Fetches the repo's files from GitHub via the Convex action
3. Mounts files into the WebContainer
4. Runs `npm install` and the project's dev server
5. Shows the dev server output in the preview iframe (via the WebContainer URL)
6. Shows loading/status feedback during each step

### What will exist after prereqs are done:
- `src/lib/webcontainer/index.ts` — `getWebContainer()`, `teardownWebContainer()`
- `src/lib/webcontainer/files.ts` — `loadFiles()`, `writeFile()`, `readFile()`
- `src/lib/webcontainer/detect.ts` — `detectProjectType()`, `detectConvex()`
- `src/lib/webcontainer/useWebContainer.ts` — `useWebContainer()` hook → `{ container, status, error }`
- `convex/github.ts` — `fetchRepoForWebContainer` action → returns FileSystemTree-shaped object

### What exists now:
- `src/app/workspace/[repoId]/page.tsx` — Workspace with chat + preview split pane
- `src/components/preview/PreviewPanel.tsx` — Currently renders `srcDoc` HTML from `sessions.getPreviewCode`

## Requirements

### 1. Create `src/lib/webcontainer/devServer.ts`

Create a utility that runs `npm install` and starts the appropriate dev server based on the detected project type.

```typescript
import { WebContainer } from "@webcontainer/api";
import { detectProjectType, type ProjectType } from "./detect";

export type DevServerStatus =
  | "idle"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface DevServerState {
  status: DevServerStatus;
  url: string | null;
  error: string | null;
  output: string[];
}

/**
 * Get the dev command for a given project type.
 */
function getDevCommand(projectType: ProjectType): { cmd: string; args: string[] } {
  switch (projectType) {
    case "nextjs":
      return { cmd: "npx", args: ["next", "dev", "--port", "3000"] };
    case "vite":
      return { cmd: "npx", args: ["vite", "--port", "3000", "--host"] };
    case "cra":
      return { cmd: "npx", args: ["react-scripts", "start"] };
    default:
      // Try generic npm run dev
      return { cmd: "npm", args: ["run", "dev"] };
  }
}

/**
 * Install dependencies and start the dev server.
 * Calls onStatus with updates as the process progresses.
 */
export async function startDevServer(
  container: WebContainer,
  onStatus: (state: Partial<DevServerState>) => void,
): Promise<void> {
  const output: string[] = [];

  // 1. Detect project type
  const projectType = await detectProjectType(container);

  // 2. Install dependencies
  onStatus({ status: "installing", output: ["Installing dependencies..."] });
  const installProcess = await container.spawn("npm", ["install"]);

  installProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        output.push(data);
        onStatus({ output: [...output] });
      },
    }),
  );

  const installExitCode = await installProcess.exit;
  if (installExitCode !== 0) {
    onStatus({
      status: "error",
      error: `npm install failed with exit code ${installExitCode}`,
      output,
    });
    return;
  }

  // 3. Start dev server
  onStatus({ status: "starting", output: [...output, "Starting dev server..."] });
  const { cmd, args } = getDevCommand(projectType);
  const serverProcess = await container.spawn(cmd, args);

  serverProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        output.push(data);
        onStatus({ output: [...output] });
      },
    }),
  );

  // 4. Listen for the server-ready event
  container.on("server-ready", (_port: number, url: string) => {
    onStatus({ status: "running", url, output: [...output] });
  });
}
```

### 2. Create `src/lib/webcontainer/useWorkspaceContainer.ts`

A higher-level hook that orchestrates the full flow: boot → fetch files → mount → install → dev server. This is the main hook the workspace page will use.

```typescript
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { getWebContainer, teardownWebContainer } from "./index";
import { loadFiles } from "./files";
import { startDevServer, type DevServerState, type DevServerStatus } from "./devServer";

export type ContainerPhase =
  | "idle"
  | "booting"
  | "fetching"
  | "mounting"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface WorkspaceContainerState {
  phase: ContainerPhase;
  previewUrl: string | null;
  error: string | null;
  output: string[];
}

export function useWorkspaceContainer(repoId: Id<"repos">) {
  const [state, setState] = useState<WorkspaceContainerState>({
    phase: "idle",
    previewUrl: null,
    error: null,
    output: [],
  });
  const fetchRepoFiles = useAction(api.github.fetchRepoForWebContainer);
  const startedRef = useRef(false);

  const boot = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      // Phase 1: Boot WebContainer
      setState((s) => ({ ...s, phase: "booting", error: null }));
      const container = await getWebContainer();

      // Phase 2: Fetch repo files from GitHub
      setState((s) => ({ ...s, phase: "fetching" }));
      const fileTree = await fetchRepoFiles({ repoId });

      // Phase 3: Mount files into WebContainer
      setState((s) => ({ ...s, phase: "mounting" }));
      await loadFiles(container, fileTree as any);

      // Phase 4-5: Install deps and start dev server
      await startDevServer(container, (devState) => {
        setState((s) => ({
          ...s,
          phase: (devState.status as ContainerPhase) ?? s.phase,
          previewUrl: devState.url ?? s.previewUrl,
          error: devState.error ?? s.error,
          output: devState.output ?? s.output,
        }));
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Failed to start preview",
      }));
    }
  }, [repoId, fetchRepoFiles]);

  useEffect(() => {
    boot();
    return () => {
      // Don't teardown on unmount — WebContainer is reused
    };
  }, [boot]);

  return state;
}
```

### 3. Update `src/components/preview/PreviewPanel.tsx`

Replace the current `srcDoc`-based preview with a dual-mode panel:
- **WebContainer preview** (primary): Shows the live dev server via iframe `src` URL when a repoId is provided
- **AI HTML preview** (fallback): Keeps the existing `srcDoc` behavior for quick AI-generated HTML snippets

The component should accept both `repoId` and `sessionId` props. When `repoId` is provided, it uses the WebContainer flow. The panel shows status during each phase (booting, fetching, installing, starting) with a terminal-style output log.

```tsx
interface PreviewPanelProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
}
```

Key UI states:
- **Booting**: Spinner + "Starting WebContainer..."
- **Fetching**: Spinner + "Loading repository files..."
- **Installing**: Terminal output scrolling from `npm install`
- **Starting**: Terminal output + "Starting dev server..."
- **Running**: iframe with `src={previewUrl}` + green "Running on localhost:3000" status bar
- **Error**: Red error message + output log + retry button

The toggle bar should add a "Terminal" tab alongside "Preview" and "Code" to show the install/build output at any time.

### 4. Update `src/app/workspace/[repoId]/page.tsx`

Pass `repoId` to the `PreviewPanel` component so it can use the WebContainer flow.

```tsx
<SplitPane
  left={<ChatPanel repoId={repoId} onSessionCreated={setSessionId} />}
  right={<PreviewPanel repoId={repoId} sessionId={sessionId} />}
/>
```

### 5. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/webcontainer/devServer.ts` | **Create** | Dev server start utility: npm install + detect + run dev command, report status |
| `src/lib/webcontainer/useWorkspaceContainer.ts` | **Create** | High-level hook orchestrating boot → fetch → mount → install → dev server |
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Replace `srcDoc` with WebContainer iframe, add phase status UI and terminal tab |
| `src/app/workspace/[repoId]/page.tsx` | **Modify** | Pass `repoId` to PreviewPanel |

## Acceptance Criteria

1. `src/lib/webcontainer/devServer.ts` exports `startDevServer()` that runs npm install + dev server and reports status via callback
2. `src/lib/webcontainer/useWorkspaceContainer.ts` exports `useWorkspaceContainer(repoId)` returning `{ phase, previewUrl, error, output }`
3. `PreviewPanel` accepts `repoId` prop and boots the WebContainer flow on mount
4. PreviewPanel shows clear status for each phase: booting → fetching → mounting → installing → starting → running
5. Once the dev server is running, an iframe with `src={previewUrl}` shows the live app
6. A "Terminal" tab shows the npm install / dev server output log
7. Error states show a message and a retry button
8. The status bar shows the dev server URL when running (green) or current phase (yellow/gray)
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- WebContainer `server-ready` event fires with `(port, url)` — the URL is what you set as the iframe `src`. This URL is a special WebContainer-proxied URL, not `localhost`.
- The iframe for WebContainer preview should NOT use `sandbox` attribute (unlike the `srcDoc` approach), as the dev server needs full capabilities.
- The iframe does need `allow="cross-origin-isolated"` for SharedArrayBuffer support within the preview.
- `npm install` in WebContainers can take 15-30 seconds for typical projects. Show meaningful progress.
- The `fetchRepoForWebContainer` action returns a plain object matching the WebContainer `FileSystemTree` shape, but TypeScript may not recognize it — use `as any` when passing to `container.mount()`.
- This task depends on both the WebContainer boot task and the GitHub actions backend task being completed first. If either is not done, this task will fail to compile.
- The `startDevServer` function is intentionally fire-and-forget for the server process — it stays running until the WebContainer is torn down.
- Consider adding a "Retry" button that calls `teardownWebContainer()` then re-runs the boot flow for error recovery.

## Completion Summary

### Files Created
- **`src/lib/webcontainer/devServer.ts`** — Dev server utility that detects project type, runs `npm install`, starts the dev server, and reports status via callback. Exports `startDevServer()`, `DevServerStatus`, and `DevServerState`.
- **`src/lib/webcontainer/useWorkspaceContainer.ts`** — High-level React hook orchestrating the full WebContainer lifecycle: boot → fetch files from GitHub via Convex action → mount files → install deps → start dev server. Exports `useWorkspaceContainer(repoId)` returning `{ phase, previewUrl, error, output, retry }`. Includes retry support via `teardownWebContainer()`.

### Files Modified
- **`src/components/preview/PreviewPanel.tsx`** — Replaced `srcDoc`-based static HTML preview with full WebContainer live preview. Now accepts `repoId` prop, uses `useWorkspaceContainer` hook, and shows phase-specific UI (spinner during boot/fetch/mount, terminal output during install/start, live iframe on running, error state with retry button). Added "Terminal" tab alongside "Preview" and "Code". Status bar shows colored phase labels (green=running, yellow=loading, red=error).
- **`src/app/workspace/[repoId]/page.tsx`** — Passes `repoId` to `PreviewPanel` component.

### Verification
- `npm -s tsc -p tsconfig.json --noEmit` passes with zero errors
- `npm run build` succeeds
- All acceptance criteria met

## Review (Reviewer 86431f87)

### Fixes Applied
1. **Fixed `idle` phase showing wrong UI in `PreviewPanel.tsx`** — The `isLoading` check excluded `phase === "idle"`, which caused a brief flash of the "Send a message to see a live preview" placeholder before the WebContainer boot kicked in. Fixed by removing the `idle` exclusion from `isLoading`, so the loading spinner shows immediately.
2. **Ran `npx convex codegen`** — The generated API types were stale and didn't include the `fileChanges` table, causing 3 TS errors in `convex/ai.ts` and `src/components/chat/ChatPanel.tsx`. After codegen, all errors resolved.

### Notes
- Import paths for `convex/_generated/*` use relative `../` paths because `@/` maps to `./src/*` and the `convex/` directory is at the project root. This is correct for this project layout.
- Code quality is good: proper `"use client"` directives, clean error/loading states, retry support, and terminal output display.
- `npx tsc -p tsconfig.json --noEmit` passes with zero errors after fixes.
