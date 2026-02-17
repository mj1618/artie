# Task: Render Markdown in AI Chat Messages

## Context

AI assistant responses in the chat panel are rendered as raw plain text (line 87 of `MessageBubble.tsx` just outputs `{content}`). When the AI explains code changes, includes code snippets, or uses formatting like lists and bold text, the output is an unformatted wall of text. This is the #1 readability gap in the chat experience — every other AI chat interface (ChatGPT, Claude, etc.) renders markdown.

### What exists now:
- `src/components/chat/MessageBubble.tsx` — Renders `{content}` as raw text inside a `<div>` with `text-sm` styling
- `src/components/chat/MessageList.tsx` — Maps messages to `<MessageBubble>` components
- AI responses from `convex/ai.ts` return markdown-formatted text (code blocks, backticks, headers, lists)
- No markdown rendering library is installed

### What's missing:
- No markdown parsing or rendering for assistant messages
- Code blocks appear as raw backtick-fenced text instead of formatted code blocks
- Inline code, bold, italic, lists, and headers are all displayed as plain text

## Requirements

### 1. Install `react-markdown` and `remark-gfm`

```bash
npm install react-markdown remark-gfm
```

`react-markdown` is the standard React markdown renderer. `remark-gfm` adds GitHub Flavored Markdown support (tables, strikethrough, task lists).

### 2. Create `src/components/chat/MarkdownContent.tsx`

A client component that renders markdown content with styled elements:

```tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Fenced code blocks
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs dark:bg-zinc-950">
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }) => {
          // Check if this is an inline code or a block code
          const isBlock = className?.startsWith("language-");
          if (isBlock) {
            return (
              <code className="font-mono text-zinc-200" {...props}>
                {children}
              </code>
            );
          }
          // Inline code
          return (
            <code
              className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-xs text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200"
              {...props}
            >
              {children}
            </code>
          );
        },
        // Other elements
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 text-sm font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-zinc-500 pl-3 italic text-zinc-400">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-zinc-700 bg-zinc-800 px-2 py-1 text-left font-medium">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-zinc-700 px-2 py-1">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

Key design decisions:
- **Code blocks**: Dark background (`zinc-900`/`zinc-950`) with monospace font, overflow-x-auto for long lines
- **Inline code**: Subtle background pill matching existing code badge styling from `ChangePreview`
- **Lists**: Indented with disc/decimal markers
- **Links**: Blue with underline, open in new tab
- **No syntax highlighting library** — keep it simple. Just monospace white text in code blocks. Syntax highlighting can be added later if desired.
- All styles should look good in both the user bubble (dark bg) and assistant bubble (light/dark bg). The component is only used for assistant messages, so the `dark:` variants match the assistant bubble's dark mode.

### 3. Update `src/components/chat/MessageBubble.tsx`

Replace the raw `{content}` output for assistant messages with the new `MarkdownContent` component:

```tsx
// Old (line 87):
{content}

// New:
{isUser ? (
  <span className="whitespace-pre-wrap">{content}</span>
) : (
  <MarkdownContent content={content} />
)}
```

**Important**: User messages should NOT be rendered as markdown — they're plain text from the user and shouldn't be interpreted. Add `whitespace-pre-wrap` to user messages to preserve line breaks (especially after the textarea upgrade allows multi-line input).

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/MarkdownContent.tsx` | **Create** | React markdown renderer with styled components |
| `src/components/chat/MessageBubble.tsx` | **Modify** | Use `MarkdownContent` for assistant messages, `whitespace-pre-wrap` for user messages |

## Acceptance Criteria

1. Assistant messages render markdown formatting (code blocks, inline code, bold, lists, headers, links, blockquotes)
2. Fenced code blocks render with dark background, monospace font, and horizontal scroll for long lines
3. Inline code renders with a subtle background pill
4. Links open in new tab with blue underline styling
5. Lists render with proper indentation and markers
6. User messages remain plain text with preserved whitespace (not rendered as markdown)
7. Tables render with borders (for GFM table support)
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
9. No visual regression — the bubble shape, padding, and colors remain the same

## Tech Notes

- `react-markdown` v9+ requires React 18+ (we're on React 19, so it's compatible)
- `remark-gfm` adds GFM features but does NOT add HTML sanitization concerns — `react-markdown` doesn't render raw HTML by default
- The `components` prop in `react-markdown` lets us override each HTML element with styled components — this is the right approach (no need for a separate CSS file)
- For the `code` component, distinguish between inline code (no `className`) and block code (has `className` starting with `language-`) to style them differently
- `react-markdown` creates a `<pre><code>` structure for fenced blocks, so we style both `pre` (outer container) and `code` (inner text)
- Keep the component lightweight — no memoization needed since messages are immutable once created
- This component is purely presentational — no hooks, no data fetching
- The `"use client"` directive is needed because `react-markdown` uses client-side rendering

## Completion Summary

### What was built
Markdown rendering for AI assistant chat messages using `react-markdown` with GitHub Flavored Markdown support (`remark-gfm`). Assistant messages now render code blocks, inline code, bold, italic, lists, headers, links, blockquotes, and tables with proper styling. User messages remain plain text with `whitespace-pre-wrap` for line break preservation.

### Files changed
| File | Action |
|------|--------|
| `package.json` / `package-lock.json` | **Modified** — added `react-markdown` and `remark-gfm` dependencies |
| `src/components/chat/MarkdownContent.tsx` | **Created** — React markdown renderer with styled Tailwind components for all markdown elements |
| `src/components/chat/MessageBubble.tsx` | **Modified** — imported `MarkdownContent`, conditionally renders markdown for assistant messages and plain text for user messages |

### Verification
- TypeScript check (`tsc --noEmit`) passes with no errors
- Next.js production build succeeds
- App loads in browser (Convex auth required for full chat UI testing)

## Review (a973b3ef)

**Reviewed all 2 files (1 created, 1 modified). No issues found.**

Checks performed:
- `src/components/chat/MarkdownContent.tsx` — `"use client"` directive present (required — uses `react-markdown` which is client-side). Props interface correctly typed. `remarkGfm` plugin configured. Code block detection via `className?.startsWith("language-")` correctly distinguishes inline vs block code. All HTML element overrides (pre, code, p, ul, ol, li, h1-h3, strong, a, blockquote, table, th, td) have appropriate Tailwind styling. Links use `target="_blank"` with `rel="noopener noreferrer"` (safe). No XSS risk — `react-markdown` doesn't render raw HTML by default.
- `src/components/chat/MessageBubble.tsx` — `"use client"` directive present. `MarkdownContent` imported from correct `@/` path. Conditional rendering: user messages use `whitespace-pre-wrap` span (plain text), assistant messages use `<MarkdownContent>`. All other existing functionality (changes badges, push button, PR links, ChangePreview) preserved correctly.
- `npm -s tsc -p tsconfig.json --noEmit` — passes with zero errors
- `npx convex dev --once` — passes
- No fixes needed — all code is clean
