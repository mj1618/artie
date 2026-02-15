# Task: Build Live Preview with Iframe Sandbox and Code View Toggle

## Context

The workspace layout is complete with a split-pane design: ChatPanel on the left, PreviewPanel on the right. The chat system is fully functional — users can send messages and receive mock AI responses. However, the PreviewPanel is still a static placeholder showing "Connect a repository to see a live preview".

The next step is to make the preview panel functional by rendering HTML/CSS/JS content in a sandboxed iframe. This is Phase 5 of the project and a core part of what makes Artie useful — users need to see live previews of code that the AI generates.

Since we don't have real AI-generated code yet (only mock responses), this task will:
1. Build the iframe preview infrastructure in PreviewPanel
2. Add a code view toggle (preview vs. source code)
3. Store the current "project code" in a Convex table so it persists and can be updated by AI responses
4. Update the mock AI to generate simple HTML changes that render in the preview
5. Wire everything together so the preview updates when the AI "generates" code

### What exists now:
- `src/components/preview/PreviewPanel.tsx` — static placeholder
- `convex/ai.ts` — mock AI `generateResponse` mutation (inserts text-only assistant messages)
- `convex/schema.ts` — has `sessions` and `messages` tables but no code/preview storage
- `src/components/chat/ChatPanel.tsx` — sends user messages and triggers mock AI response

## Requirements

### 1. Add `previewCode` field to the sessions table in `convex/schema.ts`

Add an optional `previewCode` field to the `sessions` table to store the current HTML that should be rendered in the preview:

```typescript
// In the sessions table definition, add:
previewCode: v.optional(v.string()),
```

This stores a single HTML string (a complete `<!DOCTYPE html>` document) that the preview iframe will render via `srcdoc`.

### 2. Add a `sessions.getPreviewCode` query to `convex/sessions.ts`

A query that returns the preview code for a session:

```typescript
export const getPreviewCode = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    return session?.previewCode ?? null;
  },
});
```

### 3. Update `convex/ai.ts` — Generate mock HTML code changes

Update the `generateResponse` mutation to also update the session's `previewCode` with simple HTML. This simulates the AI generating code:

- Based on the user's message, generate a simple HTML document that reflects the request
- Store it on the session via `ctx.db.patch("sessions", args.sessionId, { previewCode: html })`
- Include the HTML in the assistant message's content (wrapped in a code block for display)

Use a few template HTML responses. For example, if the user says anything, generate a simple HTML page that incorporates their request:

```typescript
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; background: #fafafa; color: #18181b; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { color: #52525b; line-height: 1.6; }
    .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 480px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from Artie</h1>
    <p>${userMessageEscaped}</p>
  </div>
</body>
</html>`;
```

Vary the templates slightly (e.g., different layouts, colors) to make demo more interesting. Escape the user message for HTML safety (replace `<`, `>`, `&`, `"` with entities).

Update the assistant message content to include: a brief description of what was changed + the HTML code in a fenced code block.

### 4. Update `src/components/preview/PreviewPanel.tsx` — Iframe preview + code toggle

Transform the placeholder into a functional preview panel:

- **Props**: Accept `sessionId` (Id<"sessions"> | null) as a prop
- **Preview code query**: Use `useQuery(api.sessions.getPreviewCode, sessionId ? { sessionId } : "skip")` to get the current preview HTML
- **View toggle**: Add a small toggle bar at the top of the panel with two buttons: "Preview" and "Code"
  - "Preview" (default): Renders the HTML in an iframe via `srcdoc`
  - "Code": Shows the raw HTML source in a `<pre><code>` block with basic syntax highlighting (just use a monospace font with muted styling — no highlighting library needed)
- **Iframe**: Use `<iframe srcDoc={previewCode} sandbox="allow-scripts" ... />` for the preview
  - The iframe should fill the available space (flex-1)
  - Add `sandbox="allow-scripts"` for safety but allow scripts to run
  - Style with no border, white background
  - Set `title="Preview"` for accessibility
- **Empty state**: When `previewCode` is null/undefined, show the existing empty state message
- **Status bar**: Update the bottom status bar:
  - When preview is available: "Preview ready" in green-ish text
  - When no preview: "No preview available" (existing text)

### 5. Update `src/components/chat/ChatPanel.tsx` — Expose sessionId

The ChatPanel currently manages `sessionId` internally. The PreviewPanel needs access to the same `sessionId` to query preview code. Move session management up to the page level:

- **ChatPanel**: Accept `sessionId` and `onSessionReady` as props instead of managing session internally
  - Remove the internal `sessionId` state and `useEffect` for `createDemo`
  - Accept `sessionId: Id<"sessions"> | null` as a prop
  - Accept `onSessionReady?: (id: Id<"sessions">) => void` is NOT needed if session is managed by parent
  - Simply use the passed-in `sessionId` for queries and mutations

- **Alternative simpler approach**: Keep ChatPanel managing its own session, but also expose the sessionId via a callback prop:
  - Add `onSessionCreated?: (sessionId: Id<"sessions">) => void` prop to ChatPanel
  - Call it when the demo session is created
  - The parent page stores the sessionId and passes it to PreviewPanel

Use the simpler approach (callback prop) to minimize changes to ChatPanel.

### 6. Update `src/app/page.tsx` — Wire sessionId between panels

Update the page to:
- Add `sessionId` state (lifted from ChatPanel concern)
- Pass `onSessionCreated` callback to ChatPanel
- Pass `sessionId` to PreviewPanel

```tsx
export default function Home() {
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <SplitPane
        left={<ChatPanel onSessionCreated={setSessionId} />}
        right={<PreviewPanel sessionId={sessionId} />}
      />
    </div>
  );
}
```

### 7. Run codegen and verify

- Run `npm -s convex codegen` after schema changes
- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `convex/schema.ts` | **Modify** | Add `previewCode` optional field to `sessions` table |
| `convex/sessions.ts` | **Modify** | Add `getPreviewCode` query |
| `convex/ai.ts` | **Modify** | Generate mock HTML and update session's previewCode |
| `src/components/preview/PreviewPanel.tsx` | **Modify** | Iframe preview with srcdoc + code view toggle |
| `src/components/chat/ChatPanel.tsx` | **Modify** | Add `onSessionCreated` callback prop |
| `src/app/page.tsx` | **Modify** | Lift sessionId state, wire between ChatPanel and PreviewPanel |

## Acceptance Criteria

1. When a user sends a message, the mock AI generates HTML code and stores it as `previewCode` on the session
2. The PreviewPanel renders the HTML in an iframe (via `srcdoc`) — the preview shows a styled HTML page
3. The "Code" toggle shows the raw HTML source code in a monospace font
4. The "Preview" toggle (default) shows the rendered iframe
5. The preview updates reactively when the AI generates new code (Convex reactivity)
6. The status bar shows "Preview ready" when code exists, "No preview available" when empty
7. The empty state is shown when no preview code exists yet (before first AI response)
8. The iframe is sandboxed (`sandbox="allow-scripts"`) for security
9. `npm -s convex codegen` completes successfully
10. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors
11. No existing functionality is broken — chat send/receive still works

## Tech Notes

- Use `srcdoc` attribute on the iframe (not `src`) to render inline HTML. This avoids CORS issues and doesn't require a separate server.
- The `sandbox="allow-scripts"` attribute restricts the iframe's capabilities while still allowing JavaScript execution in the preview.
- Escape user input before embedding in HTML templates to prevent XSS — replace `<` with `&lt;`, `>` with `&gt;`, `&` with `&amp;`, `"` with `&quot;`.
- Use `useQuery` from `"convex/react"` for the preview code query — it will reactively update when the AI generates new code.
- For the code view, a simple `<pre>` with `overflow: auto` and monospace font is sufficient — no syntax highlighting library needed at this stage.
- The view toggle state is local to PreviewPanel (useState) — doesn't need to persist.
- Import `Id` from the convex generated dataModel for typing the sessionId prop.
- Keep the iframe styled to fill available space: `className="flex-1 w-full"` with `style={{ border: "none" }}`.
- The `previewCode` field on sessions keeps things simple — one preview per session. This can be evolved later into a more sophisticated file system model.

---

## Completion Summary

### Files Modified

| File | Changes |
|------|---------|
| `convex/schema.ts` | Added `previewCode: v.optional(v.string())` to the `sessions` table definition |
| `convex/sessions.ts` | Added `getPreviewCode` query that returns preview HTML for a session |
| `convex/ai.ts` | Rewrote `generateResponse` to produce mock HTML from 3 varied templates (light card, gradient centered, dark theme), escape user input for XSS safety, patch the session's `previewCode`, and include the HTML in a fenced code block in the assistant message |
| `src/components/preview/PreviewPanel.tsx` | Replaced static placeholder with functional preview panel: accepts `sessionId` prop, queries `getPreviewCode` reactively, renders sandboxed iframe (`srcdoc` + `sandbox="allow-scripts"`), provides Preview/Code toggle buttons, shows empty state when no preview exists, and displays "Preview ready" / "No preview available" in the status bar |
| `src/components/chat/ChatPanel.tsx` | Added `onSessionCreated` callback prop; calls it when the demo session is created so the parent can share `sessionId` with PreviewPanel |
| `src/app/page.tsx` | Added `"use client"` directive, lifted `sessionId` state to page level, wires `onSessionCreated` from ChatPanel to `sessionId` state, passes `sessionId` to PreviewPanel |

### What Was Implemented

- **Sandboxed iframe preview**: The PreviewPanel renders AI-generated HTML in a sandboxed iframe via `srcdoc`, with `sandbox="allow-scripts"` for security. The iframe fills available space with no border.
- **Preview/Code toggle**: A small toggle bar at the top lets users switch between rendered preview and raw HTML source (displayed in a `<pre><code>` block).
- **Reactive updates**: Preview updates automatically via Convex reactivity — when the mock AI generates new HTML and patches the session, the `useQuery` hook in PreviewPanel picks it up instantly.
- **Mock AI HTML generation**: Three varied HTML templates (light card, gradient centered layout, dark terminal-like theme) are randomly selected. User input is HTML-escaped to prevent XSS. The assistant message includes both a description and the full HTML in a code block.
- **Session wiring**: The `sessionId` is lifted to the page level so both ChatPanel and PreviewPanel share the same session context.
- **Status bar**: Shows "Preview ready" in green when preview HTML exists, "No preview available" in muted text otherwise.

### Verification

- `npx -s convex codegen` — completed successfully
- `npx -s tsc -p tsconfig.json --noEmit` — passed with no errors
