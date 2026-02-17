# Task: Add User-Friendly Error Messages to Preview Panel

## Context

Phase 7 (Polish & Launch) includes "Error handling and edge cases" and "User feedback and notifications." The Preview Panel's error state currently displays raw JavaScript error messages directly to the user. Since Artie targets non-technical users, messages like "Failed to fetch", "NetworkError when attempting to load resource", or "process exited with code 1" are confusing and unhelpful. Users need clear, plain-language explanations and actionable suggestions.

### What exists now:
- `src/components/preview/PreviewPanel.tsx` — Error state (around line 195) shows `{error}` directly from `useWorkspaceContainer`
- `src/lib/webcontainer/useWorkspaceContainer.ts` — Sets `error` from raw `Error.message` strings (line 90)
- The error state already has a nice layout: red icon, error text, terminal output, and a "Retry" button
- Terminal output (last 10 lines) is shown below the error message

### What's missing:
- No mapping from raw errors to user-friendly messages
- No categorization of error types (network, build, resource, timeout)
- No actionable suggestions ("try refreshing", "check your internet", etc.)
- Technical error details are shown directly to non-technical users

## Requirements

### 1. Create an `errorMessage` helper function in PreviewPanel.tsx

Add a function that maps raw error strings to user-friendly messages with categories:

```tsx
interface FriendlyError {
  title: string;
  description: string;
  suggestion: string;
}

function getFriendlyError(rawError: string): FriendlyError {
  const lower = rawError.toLowerCase();

  // Network errors
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network error") || lower.includes("etch failed")) {
    return {
      title: "Connection issue",
      description: "We couldn't download the repository files.",
      suggestion: "Check your internet connection and try again.",
    };
  }

  // WebContainer boot failures
  if (lower.includes("webcontainer") || lower.includes("boot") || lower.includes("sharedarraybuffer")) {
    return {
      title: "Browser environment issue",
      description: "The preview environment couldn't start in your browser.",
      suggestion: "Try refreshing the page, or use a different browser (Chrome or Edge recommended).",
    };
  }

  // npm install failures
  if (lower.includes("npm install") || lower.includes("npm err") || lower.includes("enoent") || lower.includes("package.json")) {
    return {
      title: "Dependency installation failed",
      description: "Some project dependencies couldn't be installed.",
      suggestion: "This usually resolves on retry. Click Retry below.",
    };
  }

  // Dev server crash
  if (lower.includes("exited with code") || lower.includes("process exited") || lower.includes("eaddrinuse")) {
    return {
      title: "Dev server stopped unexpectedly",
      description: "The development server encountered an issue and stopped.",
      suggestion: "Click Retry to restart the preview.",
    };
  }

  // Timeout
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      title: "Preview took too long",
      description: "The preview didn't start within the expected time.",
      suggestion: "Large projects may take longer. Click Retry to try again.",
    };
  }

  // Out of memory / resource limits
  if (lower.includes("memory") || lower.includes("heap") || lower.includes("oom") || lower.includes("allocation")) {
    return {
      title: "Out of memory",
      description: "The preview ran out of browser memory.",
      suggestion: "Close other browser tabs and try again. Very large projects may need the Fly.io runtime instead.",
    };
  }

  // Generic fallback
  return {
    title: "Something went wrong",
    description: "The preview couldn't start.",
    suggestion: "Click Retry below. If the problem persists, check the terminal output for details.",
  };
}
```

### 2. Update the error state UI in PreviewPanel

Replace the current raw error display with the friendly error:

**Before (around line 207):**
```tsx
<p className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">
  {error}
</p>
```

**After:**
```tsx
{(() => {
  const friendly = getFriendlyError(error ?? "");
  return (
    <>
      <h3 className="text-base font-semibold text-zinc-200">{friendly.title}</h3>
      <p className="max-w-sm text-center text-sm text-zinc-400">
        {friendly.description}
      </p>
      <p className="max-w-sm text-center text-xs text-zinc-500">
        {friendly.suggestion}
      </p>
    </>
  );
})()}
```

This replaces the single red error line with:
- A clear **title** in white/light text (e.g., "Connection issue")
- A **description** in gray text explaining what happened
- A **suggestion** in lighter gray with what to do

### 3. Add a "Show details" toggle for the raw error

Non-technical users shouldn't see the raw error by default, but power users and developers should be able to access it. Add a collapsible section:

```tsx
const [showDetails, setShowDetails] = useState(false);
```

Below the friendly error message and above the terminal output:

```tsx
<button
  onClick={() => setShowDetails(!showDetails)}
  className="text-xs text-zinc-600 hover:text-zinc-400 underline"
>
  {showDetails ? "Hide technical details" : "Show technical details"}
</button>
{showDetails && error && (
  <p className="max-w-sm text-center font-mono text-xs text-red-400/70">
    {error}
  </p>
)}
```

The terminal output section (last 10 lines) should also be moved inside the `showDetails` toggle so non-technical users aren't overwhelmed:

```tsx
{showDetails && output.length > 0 && (
  <div className="w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-40 overflow-auto">
    {output.slice(-10).map((line, i) => (
      <div key={i} className="whitespace-pre-wrap break-all">
        {line}
      </div>
    ))}
  </div>
)}
```

### 4. Update the status bar error text

The status bar at the bottom currently says "Error — see details above" which is fine. Keep it as-is.

### 5. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Test by simulating various error states (disconnect network, use invalid repo) and verify the friendly messages appear
- Verify the "Show technical details" toggle works and reveals the raw error + terminal output
- Verify the "Retry" button still works as before

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Add `getFriendlyError` function, update error state UI, add show/hide details toggle |

## Acceptance Criteria

1. Error state shows a friendly **title** (e.g., "Connection issue") instead of raw error text
2. Error state shows a plain-language **description** of what went wrong
3. Error state shows an **actionable suggestion** (e.g., "Check your internet connection")
4. Raw error text and terminal output are hidden behind a "Show technical details" toggle
5. At least 6 error categories are handled: network, browser/WebContainer, npm, dev server, timeout, memory
6. Unknown errors show a generic friendly message
7. The "Retry" button still works as before
8. The status bar still shows "Error — see details above"
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a single-file change in `PreviewPanel.tsx`. No backend changes needed.
- The `getFriendlyError` function is pure — it takes a string and returns a `FriendlyError` object. Easy to extend with more patterns later.
- The `showDetails` state should be inside the `PreviewPanel` component, not a new component. Keep it simple.
- Don't over-engineer the pattern matching — simple `includes()` checks on lowercase strings are fine. We're not parsing error codes, just providing better UX.
- The terminal output was previously always visible in error state. Moving it behind the toggle is intentional — non-technical users don't need to see raw terminal output by default.

## Completion Summary

### Files Changed
| File | Change |
|------|--------|
| `src/components/preview/PreviewPanel.tsx` | Added `FriendlyError` interface and `getFriendlyError()` function with 6 error categories + generic fallback. Updated error state UI to show friendly title/description/suggestion instead of raw error text. Added `showDetails` state and "Show technical details" toggle that reveals raw error and terminal output. |

### What Was Built
- **`getFriendlyError()` helper**: Pure function that maps raw error strings to user-friendly `{title, description, suggestion}` objects via case-insensitive `includes()` matching. Handles 6 categories: network, WebContainer/browser, npm, dev server, timeout, and memory errors, plus a generic fallback.
- **Friendly error UI**: Replaced the single red `{error}` text with a structured display: bold title (`text-zinc-200`), description (`text-zinc-400`), and suggestion (`text-zinc-500`).
- **"Show technical details" toggle**: Raw error text and terminal output are now hidden behind a collapsible toggle button. Non-technical users see only the friendly message; power users can expand for diagnostics.
- **Retry button**: Unchanged and still functional.
- **Status bar**: Unchanged, still shows "Error — see details above".

### Verification
- TypeScript check (`npx tsc --noEmit`) passes with no errors.
- Browser tested with playwright-cli: navigated to workspace, confirmed error state shows "Browser environment issue" title with friendly description and suggestion, "Show technical details" button visible, "Retry" button visible, status bar shows "Error — see details above".

## Review (9710dcfd)

Reviewed `src/components/preview/PreviewPanel.tsx`. Found and fixed 1 issue:

**Fixed: Missing light-mode color variants on friendly error elements.**
The new error UI elements (title, description, suggestion, "Show technical details" button, raw error text, and terminal output container) used dark-mode-only colors (e.g., `text-zinc-200`) without `dark:` prefixed variants. The rest of the component properly supports both light and dark modes via `dark:` classes. Fixed by adding proper light/dark color pairs:
- Title: `text-zinc-200` → `text-zinc-800 dark:text-zinc-200`
- Description: `text-zinc-400` → `text-zinc-600 dark:text-zinc-400`
- Toggle button: `text-zinc-600 hover:text-zinc-400` → `text-zinc-500 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-400`
- Raw error text: `text-red-400/70` → `text-red-500/70 dark:text-red-400/70`
- Terminal container: `bg-zinc-950 text-zinc-400` → `bg-zinc-100 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400`

TypeScript check (`npx tsc --noEmit`) passes clean after fixes.
