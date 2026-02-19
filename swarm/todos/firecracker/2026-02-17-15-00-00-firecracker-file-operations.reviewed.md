# Task: Firecracker File Operations & ChatPanel Integration

## What to Build

Create `convex/firecrackerFiles.ts` — backend actions for applying file changes and executing bash commands on Firecracker VMs — and wire them into `ChatPanel.tsx` so the AI chat can modify code and run commands in Firecracker VMs.

This is the critical bridge between the AI chat and Firecracker VMs. Without it, users can see a preview but the AI cannot apply code changes or execute commands.

Follow the patterns from `convex/dropletFiles.ts` and `convex/spriteFiles.ts`.

## Files to Create

### `convex/firecrackerFiles.ts`

Backend actions that communicate with the Firecracker host API to modify files and run commands inside VMs.

**1. `applyFileChanges` action** (exported via `api`):

```typescript
export const applyFileChanges = action({
  args: {
    vmId: v.id("firecrackerVms"),
    changes: v.array(v.object({
      path: v.string(),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // 1. Verify auth (getAuthUserId)
    // 2. Get VM record, verify status is "ready" or "active"
    // 3. Get the VM's hostApi vmId
    // 4. For each file change, call the Firecracker host exec endpoint:
    //    POST http://157.230.181.26:8080/api/vms/{vmId}/exec
    //    with command: write file content to the path using base64 encoding
    //    e.g., echo '<base64>' | base64 -d > /app/{path}
    // 5. Return success/failure
  },
});
```

Use base64 encoding to safely transmit file contents through the exec command (same pattern as dropletFiles.ts). The command should be:
```bash
echo '<base64_content>' | base64 -d > /app/<filepath>
```

Create parent directories as needed:
```bash
mkdir -p /app/<dirname> && echo '<base64_content>' | base64 -d > /app/<filepath>
```

**2. `executeBashCommand` action** (exported via `api`):

```typescript
export const executeBashCommand = action({
  args: {
    vmId: v.id("firecrackerVms"),
    command: v.string(),
    timeout: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // 1. Verify auth
    // 2. Get VM record, verify status
    // 3. Call exec endpoint:
    //    POST http://157.230.181.26:8080/api/vms/{vmId}/exec
    //    Body: { "command": args.command, "timeout": args.timeout || 60000 }
    // 4. Return { exitCode, stdout, stderr }
  },
});
```

### Key implementation notes for `firecrackerFiles.ts`:

- Import `FIRECRACKER_HOST` constant from `./firecrackerVms` (or define locally as `"http://157.230.181.26:8080"`)
- Use `process.env.FIRECRACKER_API_SECRET` for auth header
- Apply file changes using `Promise.all` for parallelism (per CLAUDE.md guidance)
- Working directory inside VMs is `/app` (repo is cloned there by the setup endpoint)
- Handle errors gracefully — return structured results, don't throw

## Files to Modify

### `src/components/chat/ChatPanel.tsx`

Add Firecracker runtime handling, following the existing patterns for DigitalOcean droplets and Fly.io sprites.

**1. Add imports:**
```typescript
import { api } from "@/convex/_generated/api";
// Add firecrackerFiles actions
```

**2. Add Firecracker VM query** (similar to the droplet/sprite queries around lines 64-73):
```typescript
const firecrackerVm = useQuery(
  api.firecrackerVms.getForPreview,
  sessionId && runtime === "firecracker" ? { sessionId, repoId, branch } : "skip"
);
```

**3. Add Firecracker readiness check** (similar to droplet check around lines 117-120):
```typescript
const useFirecrackerRuntime =
  runtime === "firecracker" &&
  firecrackerVm &&
  (firecrackerVm.status === "ready" || firecrackerVm.status === "active");
```

**4. Add Firecracker file change handler** in the file-changes useEffect (around lines 174-227):
```typescript
if (useFirecrackerRuntime && firecrackerVm) {
  // Call api.firecrackerFiles.applyFileChanges
  const result = await applyFileChanges({
    vmId: firecrackerVm._id,
    changes: fileChanges.map(fc => ({ path: fc.path, content: fc.content })),
  });
  // Handle result
  return;
}
```

**5. Add Firecracker bash command handler** in the bash-commands section (around lines 179-210):
```typescript
if (useFirecrackerRuntime && firecrackerVm) {
  // Call api.firecrackerFiles.executeBashCommand
  const result = await executeBashCommand({
    vmId: firecrackerVm._id,
    command: bashCommand,
  });
  // Handle result
  return;
}
```

## How to Verify

1. Run `npx convex dev --once` — codegen succeeds with new `firecrackerFiles` actions
2. Run `npx tsc -p tsconfig.json --noEmit` — no new TypeScript errors
3. Verify that the ChatPanel correctly queries for the Firecracker VM when a repo has `runtime: "firecracker"`
4. Verify that file changes and bash commands are routed to the Firecracker actions (not WebContainer) when the runtime is `"firecracker"` and the VM is ready

## Important Notes

- Phase 1 (host API exec endpoint) is NOT deployed yet, so the actual exec calls will fail. That's expected. The backend actions should handle this gracefully (catch fetch errors, return error result).
- The `applyFileChanges` action uses base64 encoding to safely pass file content through shell commands. This is the same approach used by `dropletFiles.ts`.
- File changes should be applied in parallel using `Promise.all` for performance.
- The working directory inside the VM is `/app` — all file paths should be relative to this.

## Completion Summary

### Files Created
- **`convex/firecrackerFiles.ts`** — Backend actions for Firecracker VM file operations and command execution. Contains:
  - `applyFileChanges` action: Takes a `vmId` and `fileChangeId`, reads the file change record, applies all file changes in parallel via the host API exec endpoint using base64 encoding (`mkdir -p && echo '<b64>' | base64 -d > /app/<path>`). Marks changes as applied/failed.
  - `executeBashCommand` action: Takes a `vmId` and `bashCommandId`, reads the bash command record, executes it via the host API exec endpoint in the `/app` directory. Marks command as running/completed/failed.
  - `execInVm` helper: Calls `POST /api/vms/{vmId}/exec` on the Firecracker host with auth.
  - `getVmForApi` helper: Validates VM exists and is in ready/active status.

### Files Modified
- **`src/components/chat/ChatPanel.tsx`** — Wired Firecracker runtime support:
  - Added `useAction` hooks for `api.firecrackerFiles.applyFileChanges` and `api.firecrackerFiles.executeBashCommand`
  - Added `useQuery` for `api.firecrackerVms.getForPreview` (conditional on `runtime === "firecracker"`)
  - Added `useFirecrackerRuntime` readiness check in both file-changes and bash-commands useEffects
  - Added Firecracker branches in both useEffects (before sprite/droplet checks)
  - Updated error handler to skip `markFailed` for Firecracker (action handles its own errors)
  - Updated dependency arrays to include `firecrackerVm` and Firecracker action references

### Verification
- `npx convex dev --once` — Codegen succeeded, `api.firecrackerFiles` is available
- `npx tsc -p tsconfig.json --noEmit` — No TypeScript errors in changed files (pre-existing errors in pull-requests pages unrelated to this task)
- Browser testing blocked by pre-existing build failure in `pull-requests/[repoId]/[prNumber]/page.tsx` (missing `github.getPullRequestDetail`)

## Review (b4d87ec7)

**Reviewed files:**
- `convex/firecrackerFiles.ts` — New file
- `src/components/chat/ChatPanel.tsx` — Modified

**Checks passed:**
- `npx convex dev --once` — Codegen succeeded
- `npx tsc --noEmit` — Zero TypeScript errors

**Review findings:**
- No issues found. Code is clean and well-structured.
- `"use node"` directive present in `firecrackerFiles.ts` (needed for `Buffer` and `process.env`)
- `"use client"` directive present in `ChatPanel.tsx`
- All Convex API references verified: `api.fileChanges.getById`, `api.fileChanges.markApplied`, `api.fileChanges.markFailed`, `api.bashCommands.getByIdInternal`, `api.bashCommands.markRunning`, `api.bashCommands.markCompleted`, `api.bashCommands.markFailed`, `internal.firecrackerVms.getByIdInternal` — all exist
- `useQuery` for `getForPreview` correctly uses conditional skip with `v.optional(v.string())` branch arg
- `Promise.all` used for parallel file changes per CLAUDE.md guidance
- Error handling properly skips duplicate `markFailed` calls for firecracker runtime in catch blocks
- Dependency arrays in both `useEffect` hooks correctly include firecracker references

**Fixes applied:** None needed.
