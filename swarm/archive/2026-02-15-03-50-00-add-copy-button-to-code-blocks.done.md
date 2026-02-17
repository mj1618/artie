# Task: Add Copy-to-Clipboard Button on Chat Code Blocks

## Context

The `MarkdownContent` component renders AI chat messages with syntax-highlighted code blocks (fenced ````code```). However, there's no way to copy code from these blocks — users must manually select text, which is fiddly on small code blocks. Every modern AI chat interface (ChatGPT, Claude.ai, Gemini) shows a small "Copy" button on code blocks. This is especially important for Artie's non-technical users who may not be comfortable with text selection.

### What exists now:
- `src/components/chat/MarkdownContent.tsx` — Renders markdown via `react-markdown` with `remarkGfm`. Code blocks are rendered as `<pre><code>` with dark background styling. No copy button.
- The `pre` component renders code blocks with class `my-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs dark:bg-zinc-950`
- The `code` component inside block code gets class `font-mono text-zinc-200`
- Inline code (single backticks) is styled differently and should NOT get a copy button

### What's missing:
- No copy-to-clipboard button on fenced code blocks
- No visual feedback when code is copied (e.g., "Copied!" tooltip)

## Requirements

### 1. Update `pre` component in `src/components/chat/MarkdownContent.tsx`

Wrap the `<pre>` block in a `<div>` that has `position: relative` and add a copy button in the top-right corner:

```tsx
pre: ({ children }) => {
  return (
    <CodeBlock>{children}</CodeBlock>
  );
},
```

### 2. Create a `CodeBlock` component (inline in `MarkdownContent.tsx` or as a separate small component)

```tsx
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    // Extract text content from the <pre> element
    const text = preRef.current?.textContent ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-2">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs dark:bg-zinc-950"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded bg-zinc-700 px-1.5 py-1 text-xs text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-600 group-hover:opacity-100"
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
```

Key behaviors:
- The copy button is **invisible by default** and appears on hover over the code block (via Tailwind `group` / `group-hover:opacity-100`)
- After clicking, the button text changes to "Copied!" for 2 seconds
- Uses `navigator.clipboard.writeText()` — standard browser API, no library needed
- Extracts text from `preRef.current.textContent` to get clean text without HTML tags
- Does NOT show on inline code — only on fenced code blocks (the `pre` wrapper)

### 3. Optionally add a small copy icon instead of text

For a cleaner look, use an inline SVG clipboard icon:

```tsx
<button ...>
  {copied ? (
    // Checkmark icon
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    // Clipboard icon
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )}
</button>
```

### 4. Run verification

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/MarkdownContent.tsx` | **Modify** | Add `CodeBlock` wrapper component with copy-to-clipboard button on `<pre>` elements |

## Acceptance Criteria

1. Fenced code blocks in AI chat messages show a copy button on hover (top-right corner)
2. Clicking the copy button copies the code text to the clipboard
3. After copying, the button briefly shows "Copied!" or a checkmark icon for 2 seconds
4. The copy button does NOT appear on inline code (single backticks)
5. The button is unobtrusive — hidden by default, appears on hover
6. Multiple code blocks in the same message each have their own independent copy button
7. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- `navigator.clipboard.writeText()` works in all modern browsers. It requires a secure context (HTTPS or localhost) — fine for dev and production.
- Use `preRef.current.textContent` instead of `innerText` — `textContent` is faster and doesn't trigger layout reflow
- The `CodeBlock` component can live inside `MarkdownContent.tsx` since it's small and only used there — no need for a separate file
- The `group` / `group-hover` pattern is a standard Tailwind approach for showing child elements on parent hover
- `react-markdown` passes the `<code>` element as a child of the `<pre>` component — so `children` of `pre` is the `<code>` element. `preRef.current.textContent` will correctly extract just the text content.

## Implementation Summary

### Files Modified
- `src/components/chat/MarkdownContent.tsx` — Added `CodeBlock` component with copy-to-clipboard functionality

### What Was Built
- Added a `CodeBlock` component that wraps `<pre>` elements with a relative container and a copy button
- Copy button appears in the top-right corner on hover (using Tailwind `group`/`group-hover:opacity-100`)
- Uses SVG icons: clipboard icon (default) and checkmark icon (after copy, for 2 seconds)
- Uses `navigator.clipboard.writeText()` with `preRef.current.textContent` to extract clean text
- Updated the `pre` component in `ReactMarkdown` to use `<CodeBlock>` wrapper
- Inline code (single backticks) is unaffected — only fenced code blocks get the copy button
- Each code block has its own independent state via `useState`/`useRef`

### Verification
- TypeScript check (`npx tsc -p tsconfig.json --noEmit`) passes with no errors
- Next.js production build succeeds

### Review (Reviewer 5b55d3f0)
- **Fixed**: Removed `node` prop destructuring from the `code` component in `MarkdownContent.tsx`. In `react-markdown` v10, the `node` prop is only passed when `passNode` is enabled (which it isn't). The `node?.position` check was always evaluating to `false` at runtime, making it dead code. Replaced with a simpler `className?.startsWith("language-")` check which correctly identifies block code elements.
- Also preserved the `className` on block `<code>` elements so syntax highlighting classes are passed through.
- `CodeBlock` component: looks good — `useRef`/`useState` usage, clipboard API, and Tailwind group-hover pattern are all correct.
- `useWorkspaceContainer.ts`: reviewed — `refreshFiles`, `fileChanges` query, `removePathsFromTree` all correctly match the Convex schema types.
- `PreviewNavBar.tsx`: reviewed — optional `onRefreshFromGitHub`/`refreshing` props are cleanly handled, spinner animation looks correct.
- `PreviewPanel.tsx`: reviewed — toast integration and refresh result handling match the `useToast` hook API.
- TypeScript check passes after fix.

## Review (c8012fc0)

Reviewed `MarkdownContent.tsx`. `CodeBlock` correctly uses `useRef`/`useState`, `preRef.current.textContent` for clipboard, Tailwind group-hover for visibility. Block code detection via `className?.startsWith("language-")` is correct. Inline code unaffected. TypeScript passes, no issues found.
