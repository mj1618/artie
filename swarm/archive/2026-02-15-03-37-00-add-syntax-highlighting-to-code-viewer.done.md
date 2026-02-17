# Task: Add Syntax Highlighting to Code Tab File Viewer

## Context

The Code tab in the `PreviewPanel` uses a `FileExplorer` component that displays file contents as plain monospace text with line numbers. When a user clicks on a `.tsx`, `.ts`, `.css`, `.json`, or any other file, they see raw unformatted text. This makes it hard to read code — especially for non-technical users who are Artie's target audience. Every modern code viewer highlights syntax (keywords, strings, comments, etc.).

### What exists now:
- `src/components/preview/FileExplorer.tsx` — Renders file content as plain text with line numbers in a `<pre><code>` block. Each line is a `<div>` with a line number `<span>` and a content `<span>`. No syntax highlighting at all.
- The file viewer area is in the right pane of the FileExplorer (after the file tree sidebar)
- File content is read from the WebContainer via `readFile()` and cached in a `Map`
- The selected file path is available as `selectedFile` (e.g., `src/components/Button.tsx`)

### What's missing:
- No syntax highlighting library installed
- No language detection based on file extension
- All code appears as uniform gray text — keywords, strings, comments, operators all look the same

## Requirements

### 1. Install `shiki` for syntax highlighting

```bash
npm install shiki
```

Shiki is a high-quality syntax highlighter that uses VS Code's TextMate grammars. It produces pre-tokenized HTML with inline styles — no CSS theme files needed, works perfectly in dark/light modes. It's the highlighter used by Nuxt Content, VitePress, and Astro.

**Why Shiki over alternatives:**
- `highlight.js` requires loading CSS themes separately and has lower quality tokenization
- `prism` is heavier and requires per-language imports
- Shiki produces `<span style="color: ...">` output that works without any additional CSS setup — ideal for our dark theme

### 2. Create `src/lib/highlighter.ts` — Shiki singleton

Create a module that lazily initializes a shared Shiki highlighter instance. Shiki's WASM bundle loads once and is reused:

```typescript
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript",
        "javascript",
        "tsx",
        "jsx",
        "json",
        "css",
        "html",
        "markdown",
        "yaml",
        "toml",
        "bash",
        "python",
        "rust",
        "go",
      ],
    });
  }
  return highlighterPromise;
}

const EXTENSION_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
};

export function getLangFromPath(path: string): string | null {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return EXTENSION_TO_LANG[ext] ?? null;
}
```

### 3. Create `src/components/preview/HighlightedCode.tsx` — highlighted code viewer component

A client component that:
1. Takes `code` (string) and `filePath` (string) as props
2. Determines the language from the file extension using `getLangFromPath`
3. Loads the Shiki highlighter (shows plain text while loading)
4. Renders highlighted HTML with line numbers

```tsx
"use client";

import { useState, useEffect } from "react";
import { getHighlighter, getLangFromPath } from "@/lib/highlighter";

interface HighlightedCodeProps {
  code: string;
  filePath: string;
}

export function HighlightedCode({ code, filePath }: HighlightedCodeProps) {
  const [html, setHtml] = useState<string | null>(null);
  const lang = getLangFromPath(filePath);

  useEffect(() => {
    if (!lang) {
      setHtml(null);
      return;
    }

    let cancelled = false;

    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      const result = highlighter.codeToHtml(code, {
        lang,
        theme: "github-dark",
      });
      setHtml(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // Fallback: plain text with line numbers (for unsupported languages or while loading)
  if (!html) {
    return (
      <pre className="text-xs leading-relaxed">
        <code>
          {code.split("\n").map((line, i) => (
            <div key={i} className="flex">
              <span className="inline-block w-10 shrink-0 select-none pr-3 text-right text-zinc-400 dark:text-zinc-600">
                {i + 1}
              </span>
              <span className="whitespace-pre-wrap break-all text-zinc-700 dark:text-zinc-300">
                {line}
              </span>
            </div>
          ))}
        </code>
      </pre>
    );
  }

  // Shiki renders a full <pre><code>...</code></pre> with inline styles.
  // We need to add line numbers. Parse the HTML to extract lines and wrap with line numbers.
  // Shiki's output has each line as a `.line` span. We can use dangerouslySetInnerHTML
  // and add line numbers via CSS or by wrapping.
  //
  // Approach: render the Shiki HTML and use CSS to add line numbers via counter-reset/counter-increment.
  return (
    <div
      className="highlighted-code text-xs leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

**Styling note:** Shiki produces `<pre class="shiki ..."><code><span class="line">...</span></code></pre>`. We need to:
- Strip Shiki's default background (we use our own)
- Add line numbers — either via CSS counters or by splitting lines and wrapping

A cleaner approach is to use Shiki's `codeToTokens` API to get individual tokens, then render them manually with our line number layout:

```tsx
useEffect(() => {
  if (!lang) return;
  let cancelled = false;

  getHighlighter().then((highlighter) => {
    if (cancelled) return;
    const { tokens } = highlighter.codeToTokens(code, {
      lang,
      theme: "github-dark",
    });
    setTokenLines(tokens);
  });

  return () => { cancelled = true; };
}, [code, lang]);
```

Then render:
```tsx
{tokenLines.map((line, i) => (
  <div key={i} className="flex">
    <span className="inline-block w-10 shrink-0 select-none pr-3 text-right text-zinc-600">
      {i + 1}
    </span>
    <span className="whitespace-pre-wrap break-all">
      {line.map((token, j) => (
        <span key={j} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </span>
  </div>
))}
```

This approach is preferred because it lets us keep our existing line number layout exactly as-is, just with colored tokens instead of plain text.

### 4. Update `src/components/preview/FileExplorer.tsx` to use `HighlightedCode`

Replace the plain text `<pre><code>` block in the file viewer section with the `HighlightedCode` component:

**Before:**
```tsx
<div className="flex-1 overflow-auto p-0">
  <pre className="text-xs leading-relaxed">
    <code>
      {(fileContent ?? "").split("\n").map((line, i) => (
        <div key={i} className="flex">
          <span className="inline-block w-10 shrink-0 select-none pr-3 text-right text-zinc-400 dark:text-zinc-600">
            {i + 1}
          </span>
          <span className="whitespace-pre-wrap break-all text-zinc-700 dark:text-zinc-300">
            {line}
          </span>
        </div>
      ))}
    </code>
  </pre>
</div>
```

**After:**
```tsx
<div className="flex-1 overflow-auto p-0">
  <HighlightedCode code={fileContent ?? ""} filePath={selectedFile} />
</div>
```

### 5. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Verify the Code tab renders with syntax highlighting for `.ts`, `.tsx`, `.json`, `.css` files
- Verify unsupported extensions fall back to plain text with line numbers
- Verify the highlighter loads asynchronously (no blocking on page load)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/highlighter.ts` | **Create** | Shiki singleton initialization + file extension to language mapping |
| `src/components/preview/HighlightedCode.tsx` | **Create** | Component that renders code with Shiki syntax highlighting and line numbers |
| `src/components/preview/FileExplorer.tsx` | **Modify** | Replace plain text code viewer with `HighlightedCode` component |

## Acceptance Criteria

1. Opening a `.ts` or `.tsx` file in the Code tab shows syntax-highlighted code (keywords, strings, comments have different colors)
2. Opening a `.json` file shows highlighted keys and values
3. Opening a `.css` file shows highlighted selectors, properties, and values
4. Unsupported file extensions (e.g., `.txt`, `.env`) fall back to plain monospace text with line numbers
5. Line numbers are displayed consistently for both highlighted and plain text views
6. The Shiki highlighter loads lazily — the file content shows as plain text first, then highlights when ready
7. Switching between files reuses the same highlighter instance (no re-initialization)
8. The highlighting uses dark theme colors consistent with the app's zinc/dark color scheme
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `codeToTokens` API (not `codeToHtml`) to maintain full control over the line number layout
- The Shiki WASM bundle is ~1.5MB — it loads asynchronously and is cached by the browser after first load
- The `github-dark` theme matches the app's dark zinc color scheme well
- Limit pre-loaded languages to common web development ones (TS, JS, JSON, CSS, HTML, Markdown) plus a few extras. Shiki can dynamically load additional languages if needed in the future.
- The `getLangFromPath` function handles common aliases (`.mjs` → javascript, `.yml` → yaml, etc.)
- For very large files (>10K lines), Shiki may be slow — the fallback plain text view acts as a natural loading state while highlighting processes

---

## Implementation Summary

### What was built
Added syntax highlighting to the Code tab's file viewer using Shiki. When users open files in the FileExplorer, code is now displayed with proper syntax coloring (keywords, strings, comments, etc.) using the `github-dark` theme. Unsupported file types fall back to plain monospace text with line numbers.

### Approach
Used Shiki's `codeToTokens` API (not `codeToHtml`) to get individual tokens per line, which preserves the existing line number layout. The highlighter is lazily initialized as a singleton and shared across all file views.

### Files changed
| File | Action | Description |
|------|--------|-------------|
| `package.json` | **Modified** | Added `shiki` dependency |
| `src/lib/highlighter.ts` | **Created** | Shiki singleton with lazy init, `github-dark` theme, 14 pre-loaded languages, and `getLangFromPath()` for file extension to language mapping |
| `src/components/preview/HighlightedCode.tsx` | **Created** | Client component that tokenizes code with Shiki and renders colored spans with line numbers. Falls back to plain text for unsupported languages or while loading |
| `src/components/preview/FileExplorer.tsx` | **Modified** | Replaced inline plain-text `<pre><code>` block with `<HighlightedCode>` component |

### Verification
- `tsc --noEmit` passes with zero errors
- Next.js production build succeeds
- App renders correctly in browser (verified login page loads)

## Review (bdfd0d50)

**Reviewed all 3 files (highlighter.ts, HighlightedCode.tsx, FileExplorer.tsx). No issues found.**

Checks performed:
- `src/lib/highlighter.ts` — Singleton pattern is correct: `highlighterPromise` is module-scoped and reused. `BundledLanguage` type used correctly for the extension-to-language map. `getLangFromPath` correctly extracts extension with `lastIndexOf(".")` and lowercases it. 14 languages pre-loaded match the map entries. No issues.
- `src/components/preview/HighlightedCode.tsx` — Has `"use client"` directive. `ThemedToken` type imported from `shiki`. Effect correctly cancels on unmount/re-render. `codeToTokens` API used (not `codeToHtml`) — correct approach for maintaining line number layout. Fallback plain text renders when `tokenLines` is null (loading or unsupported language). Line number styling consistent between highlighted and fallback views.
- `src/components/preview/FileExplorer.tsx` — `HighlightedCode` imported and used correctly, replacing the old inline `<pre><code>` block. Props passed correctly: `code={fileContent ?? ""}` and `filePath={selectedFile}`. Binary file detection, file caching, and tree loading logic all intact.
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed

## Review (83ae8b15)

**Re-reviewed all 3 files. No issues found.** `highlighter.ts` singleton and extension map correct, `HighlightedCode.tsx` token-based rendering with cancellation logic correct, `FileExplorer.tsx` integration correct. `tsc --noEmit` and `convex codegen` both pass. No fixes needed.
