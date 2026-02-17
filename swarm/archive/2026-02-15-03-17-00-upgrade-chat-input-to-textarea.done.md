# Task: Upgrade Chat Input to Multi-Line Textarea

## Context

The chat input in `ChatPanel.tsx` is currently a single-line `<input type="text">`. For an AI-powered code editing interface where users describe complex changes in natural language, this is a significant UX limitation. Users can't write multi-line prompts, can't see their full message while composing, and the input feels cramped compared to other AI chat interfaces.

### What exists now:
- `src/components/chat/ChatPanel.tsx` — Has a `<form>` with an `<input type="text">` and a send button
- The form submits on Enter (standard form behavior)
- No keyboard shortcut handling for Shift+Enter or Cmd+Enter

### What's missing:
- Multi-line input (textarea) for composing longer messages
- Auto-expanding textarea that grows with content
- Shift+Enter for newline, Enter to send
- Visual improvement to match modern AI chat UX (e.g., ChatGPT, Claude)

## Requirements

### 1. Replace `<input>` with auto-expanding `<textarea>` in ChatPanel.tsx

Replace the single-line text input with a textarea that:
- Starts at 1 row height (same as the current input)
- Auto-expands as the user types more lines (up to ~6 rows max)
- Shrinks back when content is deleted
- Has `resize: none` to prevent manual resizing

**Keyboard behavior:**
- **Enter**: Submit the message (same as clicking send)
- **Shift+Enter**: Insert a newline
- Both behaviors should be handled via `onKeyDown`
- Remove the `<form onSubmit>` wrapper and handle submit directly in the keydown handler + button click

### 2. Auto-resize logic

Use a simple approach with `scrollHeight`:

```tsx
const textareaRef = useRef<HTMLTextAreaElement>(null);

const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  setInput(e.target.value);
  // Auto-resize
  const textarea = e.target;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
};
```

Reset textarea height when input is cleared after sending.

### 3. Update styling

- Keep the same border/background/focus styling as the current input
- Add `resize-none` class
- Set `rows={1}` for initial single-row height
- Maintain the same compact padding (px-3 py-2)
- The send button should align to the bottom-right of the textarea area (use `items-end` on the flex container)

### 4. Run codegen and verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/chat/ChatPanel.tsx` | **Modify** | Replace `<input>` with auto-expanding `<textarea>`, add keyboard handling |

## Acceptance Criteria

1. The chat input is a textarea that starts at single-line height
2. The textarea auto-expands as the user types multi-line content (up to ~6 lines)
3. The textarea shrinks back when content is removed
4. Pressing Enter sends the message
5. Pressing Shift+Enter inserts a newline
6. The send button aligns to the bottom of the textarea
7. After sending a message, the textarea resets to single-line height
8. The textarea is disabled while the AI is generating a response
9. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- Use `useRef` for the textarea element to reset height after send
- The `scrollHeight` approach is the simplest auto-resize method — no libraries needed
- Cap max height at ~150px (roughly 6 lines) so the textarea doesn't push the message list too far up
- Keep the form element for accessibility (screen readers), but prevent default submit and handle via keydown
- The `placeholder` text should remain: "Describe what you'd like to change..."

## Implementation Summary

### Files Changed
- `src/components/chat/ChatPanel.tsx` — Modified

### What Was Built
- Replaced single-line `<input type="text">` with an auto-expanding `<textarea>`
- Added `useRef<HTMLTextAreaElement>` for programmatic height reset after sending
- Added `handleInputChange` with auto-resize logic using `scrollHeight` (capped at 150px / ~6 rows)
- Added `handleKeyDown` handler: Enter sends the message, Shift+Enter inserts a newline
- Updated `handleSubmit` to reset textarea height via `resetTextareaHeight()` after sending
- Changed flex container to `items-end` so the send button aligns to the bottom of the textarea
- Added `resize-none` class and `rows={1}` for initial single-row height
- Kept the `<form>` element for accessibility with `onSubmit` preventing default
- Textarea is disabled while AI is generating a response (existing `sending` state)
- All existing styling (border, background, focus, dark mode) preserved

### Verification
- `npx tsc -p tsconfig.json --noEmit` passes with no errors
- Next.js production build succeeds
- Component compiled into workspace page JS bundle (confirmed `resize-none` in build output)

## Review (fb59aa08)

**Reviewed `src/components/chat/ChatPanel.tsx`. No issues found.**

Checks performed:
- `"use client"` directive present (required — uses hooks, refs, state)
- `textareaRef` correctly typed as `useRef<HTMLTextAreaElement>(null)`
- `handleInputChange` auto-resize logic correctly resets `style.height` to "auto" before measuring `scrollHeight`, with 150px max cap
- `handleKeyDown` correctly handles Enter (submit) vs Shift+Enter (newline)
- `resetTextareaHeight` correctly resets height after sending message
- `<textarea>` has `rows={1}`, `resize-none`, and `disabled={sending}` — all correct
- Send button uses `items-end` flex alignment to stay at bottom of expanding textarea
- Form `onSubmit` preserved for accessibility with `e.preventDefault()`
- All existing chat functionality (session creation, message sending, AI response, file change application) intact
- `npx -s tsc -p tsconfig.json --noEmit` — passes
- `npx -s convex codegen` — passes
- No fixes needed
