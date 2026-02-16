# Task: Add Boot Progress Stepper to Preview Panel

## Context

Phase 7 (Polish & Launch) includes "Loading states and animations" and "User feedback and notifications." The WebContainer boot sequence takes 5-30 seconds and currently shows a **single spinner with a text label** that changes as phases progress (e.g., "Starting WebContainer...", "Loading repository files...", "Installing dependencies...", "Starting dev server..."). For non-technical users, this is opaque — they have no sense of how far along the process is or how many steps remain.

A multi-step progress stepper gives users spatial awareness of the boot process: they can see which steps are done, which is current, and how many remain. This makes the wait feel shorter and more predictable.

### What exists now:
- `src/components/preview/PreviewPanel.tsx` — Has a `PhaseLabel` component that maps `ContainerPhase` to text labels. The loading state renders a spinner + `<PhaseLabel>` + last 5 lines of terminal output.
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Exports `ContainerPhase` type: `"idle" | "booting" | "fetching" | "mounting" | "installing" | "starting" | "running" | "error"`.
- The loading state JSX is in the `isLoading` conditional branch (around lines 190-205 of `PreviewPanel.tsx`).

### What's missing:
- No visual indication of overall progress (how many steps total, how many complete)
- No sense of how long the current step takes relative to others
- Users see a generic spinner with no context about what's coming next

## Requirements

### 1. Create a BootProgressStepper component

Create a `BootProgressStepper` component inline in `PreviewPanel.tsx` (no separate file needed — it's small and only used here).

The stepper shows 5 logical steps mapped from `ContainerPhase`:

| Step | Phases covered | Label |
|------|---------------|-------|
| 1 | `booting` | Starting environment |
| 2 | `fetching`, `mounting` | Loading files |
| 3 | `installing` | Installing dependencies |
| 4 | `starting` | Starting dev server |
| 5 | `running` | Ready |

Each step shows:
- **Completed**: Green circle with checkmark + step label in green
- **Current**: Pulsing/animated blue circle with a dot + step label in white, plus a subtle "spinner" animation
- **Pending**: Gray circle (dim) + step label in dim gray

Steps are laid out **vertically** (stacked list), compact, centered in the preview area.

### 2. Component interface

```tsx
function BootProgressStepper({ phase }: { phase: ContainerPhase }) {
  const steps = [
    { key: "booting", label: "Starting environment" },
    { key: "fetching", label: "Loading files" },
    { key: "installing", label: "Installing dependencies" },
    { key: "starting", label: "Starting dev server" },
    { key: "running", label: "Ready" },
  ];

  // Map current phase to step index
  const phaseToStep: Record<string, number> = {
    idle: -1,
    booting: 0,
    fetching: 1,
    mounting: 1,  // fetching and mounting are both "Loading files"
    installing: 2,
    starting: 3,
    running: 4,
  };

  const currentStep = phaseToStep[phase] ?? -1;

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, i) => {
        const isComplete = i < currentStep;
        const isCurrent = i === currentStep;
        // render step...
      })}
    </div>
  );
}
```

### 3. Step rendering

Each step row:

```tsx
<div key={step.key} className="flex items-center gap-3">
  {/* Circle indicator */}
  {isComplete ? (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
      <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>
  ) : isCurrent ? (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-blue-400 animate-pulse">
      <div className="h-2 w-2 rounded-full bg-blue-400" />
    </div>
  ) : (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-700">
      <div className="h-2 w-2 rounded-full bg-zinc-700" />
    </div>
  )}

  {/* Label */}
  <span className={`text-sm ${
    isComplete ? "text-emerald-400" : isCurrent ? "text-zinc-100" : "text-zinc-600"
  }`}>
    {step.label}
    {isCurrent && "..."}
  </span>
</div>
```

### 4. Replace the loading spinner in PreviewPanel

In `PreviewPanel.tsx`, replace the `isLoading` branch (the div with the spinner + PhaseLabel) with the new `BootProgressStepper`:

**Before (lines ~190-205):**
```tsx
) : isLoading ? (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
    <p className="text-sm text-zinc-500 dark:text-zinc-400">
      <PhaseLabel phase={phase} />
    </p>
    {output.length > 0 && (
      <div className="w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-32 overflow-auto">
        {output.slice(-5).map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>
    )}
  </div>
```

**After:**
```tsx
) : isLoading ? (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
    <BootProgressStepper phase={phase} />
    {output.length > 0 && (
      <div className="mt-2 w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-32 overflow-auto">
        {output.slice(-5).map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>
    )}
  </div>
```

Keep the terminal output snippet below the stepper — it provides useful debugging context.

### 5. Keep PhaseLabel for the status bar

The `PhaseLabel` component is still used in the status bar at the bottom of PreviewPanel. Keep it as-is — don't remove it.

### 6. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open a workspace page and observe the boot sequence — the stepper should show each phase progressing through the steps with checkmarks

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Add `BootProgressStepper` component and replace the loading spinner with it |

## Acceptance Criteria

1. A `BootProgressStepper` component exists in `PreviewPanel.tsx`
2. The stepper shows 5 steps: Starting environment, Loading files, Installing dependencies, Starting dev server, Ready
3. Completed steps show a green checkmark circle and green text
4. The current step shows a pulsing blue circle and white text with "..." suffix
5. Pending steps show a dim gray circle and dim gray text
6. `fetching` and `mounting` phases both map to the "Loading files" step
7. The terminal output snippet is preserved below the stepper
8. The `PhaseLabel` component is NOT removed (still used in status bar)
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
10. The stepper is vertically centered in the preview area (same positioning as the old spinner)

## Tech Notes

- Define `BootProgressStepper` as a plain function component in `PreviewPanel.tsx` (above the `PreviewPanel` export). No need for a separate file — it's ~40 lines of JSX.
- The `animate-pulse` class from Tailwind provides the pulsing effect on the current step's circle.
- Use `emerald-400`/`emerald-500` for completed steps (matches the status bar's running state color).
- Use `blue-400` for the current step to distinguish it from completed (green) and pending (gray).
- The "Ready" step (index 4) will briefly show as current when phase is `running`, but the `isLoading` conditional (`phase !== "running" && phase !== "error"`) means the stepper is only visible while loading. When phase reaches `running`, the preview iframe takes over. So the "Ready" step will only be seen if there's a brief moment between `running` phase and `previewUrl` becoming available — which is fine as a transitional state.
- Don't use `transition-all` on the step elements — the phase changes happen discretely (not animated between), so transitions would cause flickering.

## Completion Summary

### What was built
Added a `BootProgressStepper` component to the Preview Panel that replaces the single loading spinner with a 5-step vertical progress stepper. The stepper gives users spatial awareness of the WebContainer boot process — they can see which steps are done (green checkmarks), which is currently active (pulsing blue circle), and which are pending (dim gray circles).

### Files changed
| File | Change |
|------|--------|
| `src/components/preview/PreviewPanel.tsx` | Added `BootProgressStepper` component (~55 lines) and replaced the loading spinner in the `isLoading` branch with it. `PhaseLabel` preserved for status bar usage. |

### Verification
- TypeScript check (`npx tsc -p tsconfig.json --noEmit`) passes with no errors
- Browser-tested: navigated to workspace page, observed stepper rendering correctly during boot with completed steps showing green checkmarks, current step showing pulsing blue circle with "..." suffix, and pending steps in dim gray. Terminal output snippet preserved below stepper. Status bar still shows `PhaseLabel` text.

## Review (agent b4039a07)

Reviewed `src/components/preview/PreviewPanel.tsx`. No issues found:
- `"use client"` directive present
- `ContainerPhase` type correctly imported from `@/lib/webcontainer/useWorkspaceContainer`
- `BootProgressStepper` properly typed with `{ phase: ContainerPhase }`
- All 8 `ContainerPhase` values handled in `phaseToStep` (error not in map but unreachable — `isError` branch renders before `isLoading`)
- `fetching` and `mounting` correctly map to step index 1 ("Loading files")
- `PhaseLabel` preserved in status bar at line 303
- Terminal output snippet preserved below the stepper (lines 251-258)
- SVG checkmark path is valid
- Conditional rendering order correct: `isRunning` → `isError` → `isLoading` → fallback
- TypeScript check (`npx tsc --noEmit`) passes with zero errors
- No fixes needed
