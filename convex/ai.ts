"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, type LanguageModel } from "ai";
import { Octokit } from "@octokit/rest";

const SKIP_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /\.lock$/,
  /package-lock\.json$/,
];

const MAX_FILE_SIZE = 100_000;

function shouldSkip(path: string, size?: number): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(path))) return true;
  if (size && size > MAX_FILE_SIZE) return true;
  return false;
}

/**
 * Refresh GitHub access token using refresh token.
 * Returns new access token, refresh token, and expiry timestamp.
 */
async function refreshGithubToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshGithubToken] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET");
    return null;
  }

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("[refreshGithubToken] GitHub error:", data.error, data.error_description);
      return null;
    }

    if (!data.access_token) {
      console.error("[refreshGithubToken] No access_token in response");
      return null;
    }

    // expires_in is in seconds
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: expiresAt ?? Date.now() + 8 * 60 * 60 * 1000, // Default 8 hours if not provided
    };
  } catch (err) {
    console.error("[refreshGithubToken] Failed to refresh token:", err);
    return null;
  }
}

/**
 * Get the user's GitHub token, refreshing if expired.
 * Returns undefined if no token available.
 * Throws an error if token refresh fails (user needs to reconnect).
 */
async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);

  if (!profile?.githubAccessToken) {
    return undefined;
  }

  // Check if token is expired (with 5 minute buffer)
  const expiresAt = profile.githubTokenExpiresAt;
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    console.log("[getUserGithubToken] Token expired or expiring soon, attempting refresh");

    if (!profile.githubRefreshToken) {
      console.warn("[getUserGithubToken] No refresh token available");
      throw new Error(
        "Your GitHub connection has expired. Please reconnect your GitHub account in Settings.",
      );
    }

    const newTokens = await refreshGithubToken(profile.githubRefreshToken);

    if (!newTokens) {
      console.error("[getUserGithubToken] Failed to refresh token");
      // Clear the invalid tokens so user knows to reconnect
      await ctx.runMutation(api.users.disconnectGithub);
      throw new Error(
        "Your GitHub connection has expired and could not be refreshed. Please reconnect your GitHub account in Settings.",
      );
    }

    // Update the stored tokens
    await ctx.runMutation(api.users.updateGithubTokens, {
      githubAccessToken: newTokens.accessToken,
      githubRefreshToken: newTokens.refreshToken,
      githubTokenExpiresAt: newTokens.expiresAt,
    });

    console.log("[getUserGithubToken] Token refreshed successfully");
    return newTokens.accessToken;
  }

  return profile.githubAccessToken;
}

/** Files to prioritize for AI context. */
const PRIORITY_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^next\.config\./,
  /^vite\.config\./,
  /^tailwind\.config\./,
  /^src\/app\/.*page\.[tj]sx?$/,
  /^src\/app\/.*layout\.[tj]sx?$/,
  /^src\/components\/.*\.[tj]sx?$/,
  /^src\/lib\/.*\.[tj]sx?$/,
  /^app\/.*page\.[tj]sx?$/,
  /^app\/.*layout\.[tj]sx?$/,
  /^index\.[tj]sx?$/,
  /^src\/index\.[tj]sx?$/,
  /^src\/App\.[tj]sx?$/,
  /^src\/main\.[tj]sx?$/,
  /^src\/styles\/.*\.css$/,
  /^src\/app\/globals\.css$/,
];

const MAX_CONTEXT_FILES = 15;
const MAX_CONTEXT_BYTES = 50_000;

function selectContextFiles(
  tree: { path: string; type: string; size: number }[],
  mustInclude?: string[],
): string[] {
  const must = new Set(mustInclude ?? []);
  const blobs = tree.filter((f) => f.type === "blob");

  // Always include AGENTS.md if it exists (for project-specific AI instructions)
  const agentsMd = blobs.find((f) => f.path === "AGENTS.md");
  if (agentsMd) {
    must.add("AGENTS.md");
  }

  // Always include must-include paths first
  const selected: string[] = [];
  let totalSize = 0;
  for (const path of must) {
    const blob = blobs.find((f) => f.path === path);
    if (blob) {
      selected.push(path);
      totalSize += blob.size;
    }
  }

  // Then fill remaining slots with priority-scored files
  const scored = blobs
    .filter((f) => !must.has(f.path))
    .map((f) => {
      const isPriority = PRIORITY_PATTERNS.some((p) => p.test(f.path));
      return { path: f.path, size: f.size, score: isPriority ? 0 : 1 };
    });

  scored.sort((a, b) => a.score - b.score || a.size - b.size);

  for (const f of scored) {
    if (selected.length >= MAX_CONTEXT_FILES) break;
    if (totalSize + f.size > MAX_CONTEXT_BYTES) continue;
    selected.push(f.path);
    totalSize += f.size;
  }
  return selected;
}

function buildSystemPrompt(
  fileTree: string,
  fileContents: Record<string, string>,
): string {
  const agentsMdContent = fileContents["AGENTS.md"];

  const contentsBlock = Object.entries(fileContents)
    .filter(([path]) => path !== "AGENTS.md")
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");

  const totalFiles = fileTree.split("\n").filter((l) => l.trim()).length;
  const shownFiles = Object.keys(fileContents).filter((p) => p !== "AGENTS.md").length;

  const agentsMdBlock = agentsMdContent
    ? `\n## PROJECT-SPECIFIC INSTRUCTIONS\n\nThe following come from the project's AGENTS.md. These override the general rules above when there is a conflict.\n\n${agentsMdContent}\n`
    : "";

  return `You are Composure, an AI coding assistant. You modify files in the user's project and run commands to implement their requests.

## AGENT LOOP

You operate in an automated agent loop. After you output <bash> commands, they are executed automatically and their stdout/stderr is returned as a follow-up message prefixed with \`[bash output]\`. This is NOT from the user — treat it as command output and continue working. If a command fails, analyze the error, fix the issue, and retry. You may go through up to ${MAX_AGENT_ITERATIONS} iterations to get things working.

## WORKFLOW

1. **THINK FIRST** — Before making changes, consider: What files are involved? What are the ripple effects (imports, types, tests)? Do I need to read any files not shown below?
2. **READ BEFORE WRITE** — Only ${shownFiles} of ${totalFiles} project files are shown below. If you need to see or edit a file not shown, use \`<bash>cat path/to/file</bash>\` to read it first. Use \`<bash>grep -r "pattern" src/</bash>\` or \`<bash>find . -name "*.tsx" -path "*/components/*"</bash>\` to search the codebase.
3. **MAKE CHANGES** — Use <edit> or <file> blocks to apply changes (see format below).
4. **VERIFY** — Include a <bash> block to run the build, tests, or linter to verify your changes.
5. **MULTI-FILE CHANGES** — When renaming a component, changing a function signature, or modifying an interface, update ALL files that reference it. Grep for usages before and after.

## OUTPUT FORMAT

Your response will be parsed programmatically. Use this format:

<explanation>
Brief description of what you're changing and why (1-3 sentences)
</explanation>

For **editing existing files**, use an <edit> block with search/replace pairs:

<edit path="path/to/existing-file.tsx">
<<<<<<< SEARCH
exact lines from the original file to find
=======
replacement lines
>>>>>>> REPLACE
</edit>

For **new files** or **complete rewrites of small files**, use a <file> block:

<file path="path/to/new-file.tsx">
COMPLETE file contents here
</file>

For **running commands**:

<bash>command here</bash>

## RULES

1. **ALWAYS OUTPUT <edit> OR <file> BLOCKS** — When making ANY code change, you MUST include an <edit> or <file> block. Do NOT just describe changes in words.

2. **SEARCH BLOCKS MUST BE CHARACTER-PERFECT** — The SEARCH section of an <edit> block is matched by exact string lookup. Even one wrong character, space, or blank line causes the edit to silently fail. Copy the existing code exactly, including all whitespace and indentation. Include 3-5 surrounding context lines to make the match unique. If a pattern appears multiple times in a file, include enough surrounding lines to disambiguate. When unsure about exact content, use \`<bash>cat path/to/file</bash>\` first.

3. **PREFER <edit> FOR EXISTING FILES** — Use <edit> with search/replace for modifications. You may include multiple SEARCH/REPLACE pairs in one <edit> block. Use <file> only for brand-new files or very small files where a full rewrite is simpler.

4. **ACT IMMEDIATELY** — Do NOT say "I'll update..." or "Let me change..." and then stop. Output the <edit>/<file> block in the same response. For clearly-requested changes, proceed without asking for confirmation. If the request is ambiguous or could be implemented multiple ways with significantly different trade-offs, briefly state your chosen approach and proceed.

5. **MINIMAL CHANGES** — Only modify what's needed. Keep existing code style and conventions. Do not add comments that simply narrate what code does.

6. **MANAGE IMPORTS** — When adding code that uses symbols from other modules, add the necessary imports. When removing code, clean up unused imports.

7. **TYPE SAFETY** — Maintain TypeScript types. Avoid \`any\`. When changing a function signature or interface, update all call sites and type references.

8. **BASH** — Use <bash> for installing packages, running builds, tests, linting, or any shell command. Prefer pnpm. No sudo. Commands run from /app. **Never run \`pnpm run build\` (or \`npm run build\`) on Next.js projects** — it is slow, memory-intensive, and unnecessary. Use \`npx tsc --noEmit\` for type-checking instead.

9. **ERROR RECOVERY** — If a bash command fails, analyze the error and fix the issue. Keep iterating until the build passes.

10. **OUTPUT BUDGET** — Your response will be truncated at ~12,000 tokens. For large files (>150 lines), always use <edit> blocks instead of <file> to avoid truncation. Never output an entire large file when you only need to change a few lines.

11. **SAFETY** — Never run destructive commands (e.g. \`rm -rf\` on directories, \`DROP TABLE\`, force-pushing) without explicit user request. Do not output or log secrets, API keys, or credentials you encounter in files. Only modify files within the project directory.

12. **NEVER EDIT FILES VIA BASH** — Do NOT use \`dd\`, \`sed -i\`, \`awk\`, \`tee\`, \`echo >\`, \`cat >\`, \`printf >\`, or any other shell command to create or modify source files. These tools can corrupt files with binary data or encoding issues. ALWAYS use <edit> or <file> blocks for any file creation or modification. Bash commands should only be used for reading files, running builds, tests, linters, installing packages, and other non-file-writing operations.

## EXAMPLE

Editing an existing file with an import addition, then verifying:

<explanation>
Changing the button color from red to blue and adding the missing Icon import.
</explanation>

<edit path="src/components/Button.tsx">
<<<<<<< SEARCH
import { cn } from "../utils";

export function Button({ children }) {
  return (
    <button className="bg-red-500 text-white px-4 py-2 rounded">
=======
import { cn } from "../utils";
import { Icon } from "./Icon";

export function Button({ children }) {
  return (
    <button className="bg-blue-500 text-white px-4 py-2 rounded">
>>>>>>> REPLACE
</edit>

<bash>npx tsc --noEmit</bash>
${agentsMdBlock}
## PROJECT CONTEXT

File tree (${totalFiles} files total):
${fileTree}

Current file contents (${shownFiles} of ${totalFiles} files — use \`<bash>cat path</bash>\` to read others):
${contentsBlock}`;
}

function parseFileBlocks(
  text: string,
): { path: string; content: string }[] {
  const regex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  const files: { path: string; content: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({
      path: match[1],
      content: match[2].trim(),
    });
  }
  return files;
}

function parseEditBlocks(
  text: string,
): { path: string; edits: { search: string; replace: string }[] }[] {
  const editRegex = /<edit\s+path="([^"]+)">([\s\S]*?)<\/edit>/g;
  const srRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  const results: { path: string; edits: { search: string; replace: string }[] }[] = [];
  let editMatch;
  while ((editMatch = editRegex.exec(text)) !== null) {
    const edits: { search: string; replace: string }[] = [];
    let srMatch;
    while ((srMatch = srRegex.exec(editMatch[2])) !== null) {
      edits.push({ search: srMatch[1], replace: srMatch[2] });
    }
    if (edits.length > 0) {
      results.push({ path: editMatch[1], edits });
    }
  }
  return results;
}

function applyEditsToContent(
  original: string,
  edits: { search: string; replace: string }[],
): string {
  let content = original;
  for (const edit of edits) {
    const idx = content.indexOf(edit.search);
    if (idx === -1) {
      console.warn(`[AI] Edit search block not found, skipping`);
      continue;
    }
    content = content.slice(0, idx) + edit.replace + content.slice(idx + edit.search.length);
  }
  return content;
}

function parseExplanation(text: string): string {
  const match = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return text
    .replace(/<file\s+path="[^"]*">[\s\S]*?<\/file>/g, "")
    .replace(/<edit\s+path="[^"]*">[\s\S]*?<\/edit>/g, "")
    .replace(/<bash>[\s\S]*?<\/bash>/g, "")
    .replace(/<[^>]*$/, "")
    .trim() || "Changes applied.";
}

function parseBashBlocks(text: string): string[] {
  const regex = /<bash>([\s\S]*?)<\/bash>/g;
  const commands: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const cmd = match[1].trim();
    if (cmd) {
      commands.push(cmd);
    }
  }
  return commands;
}

const BASH_FILE_WRITE_PATTERNS = [
  /\bdd\b.*\bof=/,
  /\bdd\b.*>/,
  /\bsed\s+-i\b/,
  /\bawk\b.*>(?!&)/,
  /\btee\s+(?!\/dev\/)/,
  /\bprintf\b.*>\s*\S/,
  /\becho\b.*>\s*\S/,
  /\bcat\b.*>\s*\S/,
];

function isBashFileWriteCommand(command: string): boolean {
  return BASH_FILE_WRITE_PATTERNS.some((pattern) => pattern.test(command));
}

function extractDisplayContent(text: string): string {
  const explMatch = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (explMatch) {
    const afterExpl = text.slice(
      text.indexOf("</explanation>") + "</explanation>".length,
    );
    const hasFileStart = afterExpl.includes("<file") || afterExpl.includes("<edit");
    const hasBashStart = afterExpl.includes("<bash");
    let content = explMatch[1].trim();
    const actions: string[] = [];
    if (hasFileStart) actions.push("editing files");
    if (hasBashStart) actions.push("running commands");
    if (actions.length > 0) {
      content += `\n\n*${actions.join(", ")}...*`;
    }
    return content;
  }
  const cleaned = text
    .replace(/<[^>]*$/, "")
    .replace(/<explanation>/g, "")
    .trim();
  return cleaned || "Thinking...";
}

// --- Runtime execution helpers for the agent loop ---

type RuntimeExecInfo =
  | { type: "docker"; hostContainerId: string; hostUrl: string; apiSecret: string }
  | { type: "sprite"; apiUrl: string; apiSecret: string }
  | { type: "droplet"; apiUrl: string; apiSecret: string }
  | { type: "firecracker"; hostVmId: string; hostUrl: string; apiSecret: string }
  | null;

async function resolveRuntimeExecInfo(
  ctx: ActionCtx,
  repo: { runtime?: string } | null,
  sessionId: string,
): Promise<RuntimeExecInfo> {
  if (!repo?.runtime) return null;

  if (repo.runtime === "docker") {
    const container = await ctx.runQuery(api.dockerContainers.getForSession, {
      sessionId: sessionId as any,
    });
    if (
      container &&
      (container.status === "ready" || container.status === "active") &&
      container.containerId
    ) {
      const apiSecret = process.env.DOCKER_API_SECRET;
      const hostUrl = process.env.DOCKER_HOST_URL;
      if (apiSecret && hostUrl) {
        return { type: "docker", hostContainerId: container.containerId, hostUrl, apiSecret };
      }
    }
  }

  if (repo.runtime === "flyio-sprite") {
    const sprite = await ctx.runQuery(api.flyioSprites.getBySession, {
      sessionId: sessionId as any,
    });
    if (
      sprite &&
      sprite.status === "running" &&
      sprite.cloneStatus === "ready" &&
      sprite.apiUrl &&
      sprite.apiSecret
    ) {
      return { type: "sprite", apiUrl: sprite.apiUrl, apiSecret: sprite.apiSecret };
    }
  }

  if (repo.runtime === "digitalocean-droplet") {
    const droplet = await ctx.runQuery(api.droplets.getBySession, {
      sessionId: sessionId as any,
    });
    if (
      droplet &&
      (droplet.status === "ready" || droplet.status === "active") &&
      droplet.apiUrl &&
      droplet.apiSecret
    ) {
      return { type: "droplet", apiUrl: droplet.apiUrl, apiSecret: droplet.apiSecret };
    }
  }

  if (repo.runtime === "firecracker") {
    const vm = await ctx.runQuery(api.firecrackerVms.getForSession, {
      sessionId: sessionId as any,
    });
    if (
      vm &&
      (vm.status === "ready" || vm.status === "active") &&
      vm.vmId
    ) {
      const apiSecret = process.env.FIRECRACKER_API_SECRET;
      const hostUrl = process.env.FIRECRACKER_HOST_URL || "http://157.230.181.26:8080";
      if (apiSecret) {
        return { type: "firecracker", hostVmId: vm.vmId, hostUrl, apiSecret };
      }
    }
  }

  return null;
}

async function execCommandInRuntime(
  runtimeInfo: NonNullable<RuntimeExecInfo>,
  command: string,
  timeout = 120000,
): Promise<{ exitCode: number; output: string }> {
  const fullCommand = `cd /app && ${command}`;

  if (runtimeInfo.type === "docker") {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), timeout + 10000);
    try {
      const resp = await fetch(
        `${runtimeInfo.hostUrl}/api/containers/${runtimeInfo.hostContainerId}/exec`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${runtimeInfo.apiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ command: fullCommand, timeout }),
          signal: controller.signal,
        },
      );
      if (!resp.ok) throw new Error(`Docker exec failed: ${await resp.text()}`);
      const result = (await resp.json()) as { exitCode: number; stdout: string; stderr: string };
      return { exitCode: result.exitCode, output: (result.stdout || "") + (result.stderr || "") };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Command timed out after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  if (runtimeInfo.type === "sprite" || runtimeInfo.type === "droplet") {
    const resp = await fetch(`${runtimeInfo.apiUrl}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtimeInfo.apiSecret}`,
      },
      body: JSON.stringify({ command: fullCommand, timeout }),
    });
    if (!resp.ok) throw new Error(`Exec failed: ${await resp.text()}`);
    const result = (await resp.json()) as { exitCode: number; output: string };
    return { exitCode: result.exitCode, output: result.output || "" };
  }

  if (runtimeInfo.type === "firecracker") {
    const resp = await fetch(
      `${runtimeInfo.hostUrl}/api/vms/${runtimeInfo.hostVmId}/exec`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtimeInfo.apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: fullCommand, timeout }),
      },
    );
    if (!resp.ok) throw new Error(`Exec failed: ${await resp.text()}`);
    const result = (await resp.json()) as { exitCode: number; stdout: string; stderr: string };
    return { exitCode: result.exitCode, output: (result.stdout || "") + (result.stderr || "") };
  }

  throw new Error(`Unknown runtime type`);
}

async function applyFilesToRuntime(
  runtimeInfo: NonNullable<RuntimeExecInfo>,
  files: { path: string; content: string }[],
): Promise<void> {
  for (const file of files) {
    const base64Content = Buffer.from(file.content).toString("base64");
    const dirPath = file.path.includes("/")
      ? file.path.substring(0, file.path.lastIndexOf("/"))
      : "";
    const mkdirCmd = dirPath ? `mkdir -p '${dirPath}' && ` : "";
    const command = `${mkdirCmd}printf '%s' '${base64Content}' | base64 -d > '${file.path}'`;
    await execCommandInRuntime(runtimeInfo, command, 30000);
  }
}

const MAX_AGENT_ITERATIONS = 5;
const MAX_OUTPUT_CHARS = 8000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return output.slice(0, half) + "\n\n[...truncated...]\n\n" + output.slice(-half);
}

export const generateResponse = action({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    // 1. Fetch recent messages for context
    const messages = await ctx.runQuery(api.messages.list, {
      sessionId: args.sessionId,
    });
    const recentMessages = messages.slice(-10);

    try {
      // 2. Resolve LLM provider from team config
      let model: LanguageModel;

      const session = await ctx.runQuery(api.sessions.get, {
        sessionId: args.sessionId,
      });
      const repo = session
        ? await ctx.runQuery(api.projects.get, { repoId: session.repoId })
        : null;
      const team = repo
        ? await ctx.runQuery(internal.teams.getTeamInternal, {
          teamId: repo.teamId,
        })
        : null;

      const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-6";
      let modelName: string = DEFAULT_ANTHROPIC_MODEL;

      const defaultModel = () =>
        createAnthropic({
          apiKey: process.env.CLAUDE_API_KEY,
        })(DEFAULT_ANTHROPIC_MODEL);

      if (team?.llmProvider && team?.llmApiKey) {
        switch (team.llmProvider) {
          case "openai":
            modelName = team.llmModel || "gpt-4";
            model = createOpenAI({ apiKey: team.llmApiKey })(modelName);
            break;
          case "anthropic":
            modelName = team.llmModel || DEFAULT_ANTHROPIC_MODEL;
            model = createAnthropic({ apiKey: team.llmApiKey })(modelName);
            break;
          case "google":
            modelName = team.llmModel || "gemini-pro";
            model = createGoogleGenerativeAI({ apiKey: team.llmApiKey })(modelName);
            break;
          default:
            model = defaultModel();
        }
      } else {
        model = defaultModel();
      }

      // 3. Fetch repo file tree and context files (from container or GitHub)
      let systemPrompt: string;
      let repoFileContents: Record<string, string> = {};
      const originalFileContents: Record<string, string> = {};
      if (repo) {
        let fileTreeStr = "";
        const fileContents: Record<string, string> = {};

        // Check if we should fetch from a Fly.io Sprite container
        const sprite = session
          ? await ctx.runQuery(api.flyioSprites.getBySession, {
            sessionId: args.sessionId,
          })
          : null;

        const useSpriteForContext =
          repo.runtime === "flyio-sprite" &&
          sprite?.status === "running" &&
          sprite?.cloneStatus === "ready" &&
          sprite?.apiUrl &&
          sprite?.apiSecret;

        if (useSpriteForContext && sprite) {
          // Fetch from Fly.io Sprite container
          try {
            const treeResponse = await fetch(
              `${sprite.apiUrl}/files/tree?maxSize=${MAX_FILE_SIZE}`,
              {
                headers: {
                  Authorization: `Bearer ${sprite.apiSecret}`,
                },
              }
            );

            if (!treeResponse.ok) {
              throw new Error(`Failed to fetch file tree from sprite: ${await treeResponse.text()}`);
            }

            const treeData = await treeResponse.json();
            const tree = treeData.files
              .filter((f: { path: string; size: number }) => !shouldSkip(f.path, f.size))
              .map((f: { path: string; size: number; isText: boolean }) => ({
                path: f.path,
                type: "blob",
                size: f.size,
              }));

            fileTreeStr = tree.map((f: { path: string }) => f.path).join("\n");

            const sessionEdits = await ctx.runQuery(
              internal.fileChanges.getCurrentFiles,
              { sessionId: args.sessionId }
            );
            const editedPaths = Object.keys(sessionEdits);
            const contextPaths = selectContextFiles(tree, editedPaths);

            const BATCH = 20;
            for (let i = 0; i < contextPaths.length; i += BATCH) {
              const batch = contextPaths.slice(i, i + BATCH);
              const batchResponse = await fetch(`${sprite.apiUrl}/files/read-batch`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${sprite.apiSecret}`,
                },
                body: JSON.stringify({ paths: batch }),
              });

              if (batchResponse.ok) {
                const batchData = await batchResponse.json();
                for (const file of batchData.files) {
                  if (file.content && !file.error) {
                    fileContents[file.path] = file.content;
                  }
                }
              }
            }

            for (const [path, content] of Object.entries(sessionEdits)) {
              fileContents[path] = content;
            }

            console.log(`[AI] Fetched ${Object.keys(fileContents).length} files from Sprite container`);
          } catch (spriteError) {
            console.error("[AI] Failed to fetch from Sprite, falling back to GitHub:", spriteError);
          }
        }

        // Check if we should fetch from a Docker container
        if (Object.keys(fileContents).length === 0 && repo.runtime === "docker") {
          const dockerContainer = session
            ? await ctx.runQuery(api.dockerContainers.getForSession, {
              sessionId: args.sessionId,
            })
            : null;

          const useDockerForContext =
            dockerContainer &&
            (dockerContainer.status === "ready" || dockerContainer.status === "active") &&
            dockerContainer.containerId;

          if (useDockerForContext && dockerContainer?.containerId) {
            const dockerApiSecret = process.env.DOCKER_API_SECRET;
            const dockerHostUrl = process.env.DOCKER_HOST_URL!;

            if (dockerApiSecret) {
              try {
                const execDockerCmd = async (command: string, timeout = 30000) => {
                  const resp = await fetch(
                    `${dockerHostUrl}/api/containers/${dockerContainer.containerId}/exec`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${dockerApiSecret}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ command, timeout }),
                    }
                  );
                  if (!resp.ok) throw new Error(`Docker exec failed: ${await resp.text()}`);
                  return (await resp.json()) as { exitCode: number; stdout: string; stderr: string };
                };

                // Get file tree from Docker container
                const treeResult = await execDockerCmd(
                  `find /app -maxdepth 8 -type f ` +
                  `-not -path '*/node_modules/*' -not -path '*/.git/*' ` +
                  `-not -path '*/dist/*' -not -path '*/.next/*' ` +
                  `-not -name '*.lock' -not -name 'package-lock.json' ` +
                  `2>/dev/null | head -500`
                );

                if (treeResult.exitCode === 0 && treeResult.stdout.trim()) {
                  const filePaths = treeResult.stdout.trim().split("\n")
                    .map((p) => p.replace(/^\/app\//, ""))
                    .filter((p) => p && !shouldSkip(p));

                  const tree = filePaths.map((p) => ({ path: p, type: "blob" as const, size: 0 }));
                  fileTreeStr = filePaths.join("\n");

                  // Get file sizes for context selection
                  const sizeResult = await execDockerCmd(
                    `find /app -maxdepth 8 -type f ` +
                    `-not -path '*/node_modules/*' -not -path '*/.git/*' ` +
                    `-not -path '*/dist/*' -not -path '*/.next/*' ` +
                    `-not -name '*.lock' -not -name 'package-lock.json' ` +
                    `-printf '%s\\t%P\\n' 2>/dev/null | head -500`
                  );

                  if (sizeResult.exitCode === 0 && sizeResult.stdout.trim()) {
                    const sizeMap = new Map<string, number>();
                    for (const line of sizeResult.stdout.trim().split("\n")) {
                      const [sizeStr, path] = line.split("\t", 2);
                      if (path && sizeStr) sizeMap.set(path, parseInt(sizeStr, 10) || 0);
                    }
                    for (const t of tree) {
                      t.size = sizeMap.get(t.path) ?? 0;
                    }
                  }

                  const sessionEdits = await ctx.runQuery(
                    internal.fileChanges.getCurrentFiles,
                    { sessionId: args.sessionId }
                  );
                  const editedPaths = Object.keys(sessionEdits);
                  const contextPaths = selectContextFiles(tree, editedPaths);

                  // Fetch file contents via exec in batches
                  const BATCH = 10;
                  for (let i = 0; i < contextPaths.length; i += BATCH) {
                    const batch = contextPaths.slice(i, i + BATCH);
                    const separator = "===COMPOSURE_FILE_SEP===";
                    const catCmd = batch
                      .map((p) => `printf '${separator}%s${separator}\\n' '${p}' && cat '/app/${p}' 2>/dev/null`)
                      .join(" && ");

                    const readResult = await execDockerCmd(catCmd);
                    if (readResult.exitCode === 0 || readResult.stdout) {
                      const output = readResult.stdout;
                      const parts = output.split(separator);
                      // Parts alternate: empty, path, empty, content, path, empty, content, ...
                      for (let j = 1; j < parts.length; j += 2) {
                        const filePath = parts[j].trim();
                        if (filePath && j + 1 < parts.length) {
                          const content = parts[j + 1];
                          if (content !== undefined) {
                            // Content starts after the newline following the separator
                            const trimmedContent = content.startsWith("\n") ? content.slice(1) : content;
                            if (trimmedContent.length <= MAX_FILE_SIZE) {
                              fileContents[filePath] = trimmedContent;
                            }
                          }
                        }
                      }
                    }
                  }

                  for (const [path, content] of Object.entries(sessionEdits)) {
                    fileContents[path] = content;
                  }

                  console.log(`[AI] Fetched ${Object.keys(fileContents).length} files from Docker container`);
                }
              } catch (dockerError) {
                console.error("[AI] Failed to fetch from Docker container, falling back to GitHub:", dockerError);
              }
            }
          }
        }

        // If we didn't get files from a container (or it failed), fetch from GitHub
        if (Object.keys(fileContents).length === 0) {
          const userToken = await getUserGithubToken(ctx);
          const octokit = new Octokit({ auth: userToken || process.env.GITHUB_TOKEN });

          // Use session's branch if available, fall back to repo default
          let branch = session?.branchName ?? repo.defaultBranch;
          let treeData;
          try {
            const result = await octokit.git.getTree({
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              tree_sha: branch,
              recursive: "1",
            });
            treeData = result.data;
          } catch {
            // Branch doesn't exist on GitHub yet, fall back to default
            branch = repo.defaultBranch;
            const result = await octokit.git.getTree({
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              tree_sha: branch,
              recursive: "1",
            });
            treeData = result.data;
          }

          const tree = treeData.tree
            .filter(
              (item) =>
                item.path && !shouldSkip(item.path, item.size ?? undefined),
            )
            .map((item) => ({
              path: item.path!,
              type: item.type as string,
              size: item.size ?? 0,
            }));

          fileTreeStr = tree
            .map((f) => (f.type === "tree" ? `${f.path}/` : f.path))
            .join("\n");

          // Fetch prior session edits to overlay onto GitHub files
          const sessionEdits = await ctx.runQuery(
            internal.fileChanges.getCurrentFiles,
            { sessionId: args.sessionId },
          );
          const editedPaths = Object.keys(sessionEdits);

          const contextPaths = selectContextFiles(tree, editedPaths);

          // Fetch contents in parallel batches
          const BATCH = 20;
          for (let i = 0; i < contextPaths.length; i += BATCH) {
            const batch = contextPaths.slice(i, i + BATCH);
            const results = await Promise.all(
              batch.map(async (path) => {
                try {
                  const { data } = await octokit.repos.getContent({
                    owner: repo.githubOwner,
                    repo: repo.githubRepo,
                    path,
                    ref: branch,
                  });
                  if ("content" in data && data.encoding === "base64") {
                    return {
                      path,
                      content: Buffer.from(data.content, "base64").toString(
                        "utf-8",
                      ),
                    };
                  }
                  return null;
                } catch {
                  return null;
                }
              }),
            );
            for (const r of results) {
              if (r) fileContents[r.path] = r.content;
            }
          }

          // Overlay session edits: session-edited versions override GitHub originals
          for (const [path, content] of Object.entries(sessionEdits)) {
            fileContents[path] = content;
          }
        }

        systemPrompt = buildSystemPrompt(fileTreeStr, fileContents);
        if (repo.customPrompt) {
          systemPrompt += `\n\n## Custom Instructions\n\n${repo.customPrompt}`;
        }
        repoFileContents = fileContents;
        // Copy initial contents to originalFileContents for later diff display
        Object.assign(originalFileContents, fileContents);
      } else {
        // Fallback: no repo connected, use the old HTML-generation prompt
        const modelInfo = modelName ? ` You are powered by ${modelName}.` : "";
        systemPrompt = `You are Composure, an AI web development assistant.${modelInfo} Users describe what they want to see, and you build it as a single HTML page with inline CSS and JavaScript.

When responding:
1. First, briefly explain what you're building in a friendly, non-technical way.
2. Then provide a complete, self-contained HTML page that implements the request.

Format your response exactly like this:
<explanation>
Your friendly explanation here
</explanation>
<html-preview>
<!DOCTYPE html>
<html>...complete page here...</html>
</html-preview>`;
      }

      // 4. Create placeholder streaming message immediately
      const messageId = await ctx.runMutation(
        api.messages.createStreamingMessage,
        { sessionId: args.sessionId },
      );

      try {
        // 5. Resolve runtime exec info for server-side bash execution
        const runtimeInfo = await resolveRuntimeExecInfo(ctx, repo, args.sessionId);

        // 6. Agent loop: call LLM, execute bash, feed results back
        type TextPart = { type: "text"; text: string };
        type ImagePart = { type: "image"; image: URL };
        type UserContent = (TextPart | ImagePart)[];
        type ConversationMessage =
          | { role: "user"; content: string | UserContent }
          | { role: "assistant"; content: string };

        const conversationMessages: ConversationMessage[] = await Promise.all(
          recentMessages.map(async (m: { role: string; content: string; imageIds?: string[] }) => {
            if (m.role === "user" && m.imageIds && m.imageIds.length > 0) {
              const imageUrls = await Promise.all(
                m.imageIds.map((id: string) =>
                  ctx.storage.getUrl(id as Id<"_storage">),
                ),
              );
              const parts: UserContent = [];
              for (const url of imageUrls) {
                if (url) parts.push({ type: "image", image: new URL(url) });
              }
              parts.push({ type: "text", text: m.content });
              return { role: "user" as const, content: parts };
            }
            return {
              role: m.role as "user" | "assistant",
              content: m.content,
            };
          }),
        );

        let allFileChanges: { path: string; content: string }[] = [];
        let allBashCommands: { command: string; output: string; exitCode: number }[] = [];
        const allExplanations: string[] = [];
        let lastFullText = "";
        let wasStopped = false;

        const checkStopRequested = async (): Promise<boolean> => {
          const s = await ctx.runQuery(api.sessions.get, { sessionId: args.sessionId });
          return s?.stopRequested === true;
        };

        for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
          console.log(`[AI] Agent loop iteration ${iteration + 1}/${MAX_AGENT_ITERATIONS}`);

          if (await checkStopRequested()) {
            console.log("[AI] Stop requested before iteration, aborting");
            wasStopped = true;
            break;
          }

          // 6a. Call the LLM with streaming
          const abortController = new AbortController();
          const result = streamText({
            model,
            system: systemPrompt,
            maxOutputTokens: 32768,
            messages: conversationMessages,
            abortSignal: abortController.signal,
          });

          // 6b. Collect chunks and periodically flush to the database
          let accumulated = "";
          let lastFlush = Date.now();
          let lastStopCheck = Date.now();
          const FLUSH_INTERVAL = 300;
          const MIN_FLUSH_CHARS = 50;
          const STOP_CHECK_INTERVAL = 2000;
          let stopped = false;

          try {
            for await (const chunk of result.textStream) {
              accumulated += chunk;

              const now = Date.now();

              if (now - lastStopCheck > STOP_CHECK_INTERVAL) {
                lastStopCheck = now;
                if (await checkStopRequested()) {
                  console.log("[AI] Stop requested during streaming, aborting");
                  stopped = true;
                  abortController.abort();
                  break;
                }
              }

              if (
                now - lastFlush > FLUSH_INTERVAL &&
                accumulated.length > MIN_FLUSH_CHARS
              ) {
                const displayContent = extractDisplayContent(accumulated);
                await ctx.runMutation(api.messages.updateStreamingContent, {
                  messageId,
                  content: displayContent,
                });
                lastFlush = now;
              }
            }
          } catch (streamErr) {
            if (streamErr instanceof Error && streamErr.name === "AbortError") {
              stopped = true;
            } else {
              throw streamErr;
            }
          }

          if (stopped) {
            lastFullText = accumulated;
            wasStopped = true;
            break;
          }

          // 6c. Parse the response
          const fullText = accumulated;
          const explanation = parseExplanation(fullText);
          const fileChanges = parseFileBlocks(fullText);
          const editBlocks = parseEditBlocks(fullText);
          const bashCommands = parseBashBlocks(fullText);

          // 6c-ii. Resolve <edit> blocks into full file contents
          for (const eb of editBlocks) {
            const existing = repoFileContents[eb.path];
            if (existing !== undefined) {
              const updated = applyEditsToContent(existing, eb.edits);
              fileChanges.push({ path: eb.path, content: updated });
              repoFileContents[eb.path] = updated;
            } else if (runtimeInfo) {
              try {
                const result = await execCommandInRuntime(runtimeInfo, `cat '${eb.path}'`, 10000);
                if (result.exitCode === 0 && result.output) {
                  // Preserve original content for diff display before updating
                  if (originalFileContents[eb.path] === undefined) {
                    originalFileContents[eb.path] = result.output;
                  }
                  const updated = applyEditsToContent(result.output, eb.edits);
                  fileChanges.push({ path: eb.path, content: updated });
                  repoFileContents[eb.path] = updated;
                } else {
                  console.warn(`[AI] Cannot apply edit to ${eb.path}: file not found in runtime`);
                }
              } catch {
                console.warn(`[AI] Cannot apply edit to ${eb.path}: runtime read failed`);
              }
            } else {
              console.warn(`[AI] Cannot apply edit to ${eb.path}: no original content available`);
            }
          }

          console.log(`[AI] Iteration ${iteration + 1}: ${fullText.length} chars, ${fileChanges.length} files (${editBlocks.length} via edit), ${bashCommands.length} bash commands`);

          allExplanations.push(explanation);
          lastFullText = fullText;
          allFileChanges = [...allFileChanges, ...fileChanges];

          // 6d. Apply file changes to the container so bash commands see them
          if (fileChanges.length > 0 && runtimeInfo) {
            try {
              await applyFilesToRuntime(runtimeInfo, fileChanges);
              console.log(`[AI] Applied ${fileChanges.length} files to ${runtimeInfo.type} container`);
            } catch (applyErr) {
              console.error("[AI] Failed to apply files to container:", applyErr);
            }
          }

          // 6e. If no bash commands or no server-side runtime, we're done
          if (bashCommands.length === 0 || !runtimeInfo) {
            // Still save non-executed bash commands for client-side WebContainer
            if (bashCommands.length > 0 && !runtimeInfo) {
              await Promise.all(
                bashCommands.map((command) =>
                  ctx.runMutation(internal.bashCommands.saveBashCommand, {
                    sessionId: args.sessionId,
                    messageId,
                    command,
                  }),
                ),
              );
            }
            break;
          }

          // 6f. Execute bash commands and collect results
          const streamingPrefix = allExplanations[0] || explanation;
          await ctx.runMutation(api.messages.updateStreamingContent, {
            messageId,
            content: streamingPrefix + "\n\n*running commands...*",
          });

          const bashResults: string[] = [];
          for (const command of bashCommands) {
            let output: string;
            let exitCode: number;

            if (isBashFileWriteCommand(command)) {
              output = "BLOCKED: Do not use shell commands (dd, sed -i, awk, tee, etc.) to write or modify files. Use <edit> or <file> blocks instead.";
              exitCode = 1;
            } else {
              try {
                const result = await execCommandInRuntime(runtimeInfo, command);
                output = result.output;
                exitCode = result.exitCode;
              } catch (err) {
                output = err instanceof Error ? err.message : "Unknown error";
                exitCode = 1;
              }
            }

            allBashCommands.push({ command, output, exitCode });

            const status = exitCode === 0 ? "succeeded" : "failed";
            bashResults.push(
              `$ ${command}\n[exit code ${exitCode}, ${status}]\n${truncateOutput(output)}`,
            );
          }

          // 6g. Append assistant response + bash results to conversation for next iteration
          conversationMessages.push({
            role: "assistant",
            content: fullText,
          });
          conversationMessages.push({
            role: "user",
            content: `[bash output]\n${bashResults.join("\n\n")}`,
          });
        }

        // 7. Clear stop flag
        await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId });

        // 8. Finalize: deduplicate file changes (last write wins per path)
        let fileChangeId: Id<"fileChanges"> | null = null;
        const finalFilesMap = new Map<string, string>();
        for (const f of allFileChanges) {
          finalFilesMap.set(f.path, f.content);
        }
        const changedPaths = [...finalFilesMap.keys()];

        console.log(`[AI] Final: ${changedPaths.length} files changed, ${allBashCommands.length} bash commands executed`);

        // 8. Build final message content from all iterations
        let finalContent: string;
        if (wasStopped) {
          const partial = extractDisplayContent(lastFullText);
          finalContent = partial ? partial + "\n\n*(Stopped)*" : "*(Stopped)*";
        } else if (allBashCommands.length === 0) {
          finalContent = allExplanations[allExplanations.length - 1] || "Changes applied.";
        } else {
          const parts: string[] = [];
          // Use the first explanation as the primary summary
          parts.push(allExplanations[0] || "Changes applied.");

          // Add command execution summary
          const cmdSummaryLines: string[] = [];
          for (const cmd of allBashCommands) {
            const icon = cmd.exitCode === 0 ? "\u2713" : "\u2717";
            const shortOutput = cmd.output.trim().split("\n").slice(-3).join("\n").trim();
            cmdSummaryLines.push(`\`${cmd.command}\` ${icon}${shortOutput ? `\n\`\`\`\n${shortOutput}\n\`\`\`` : ""}`);
          }
          parts.push("**Commands run:**\n" + cmdSummaryLines.join("\n\n"));

          // If the agent iterated to fix errors, include the fix explanation
          if (allExplanations.length > 1) {
            const laterExplanations = allExplanations.slice(1).filter((e) => e && e !== "Changes applied.");
            if (laterExplanations.length > 0) {
              parts.push(laterExplanations.join("\n\n"));
            }
          }
          finalContent = parts.join("\n\n");
        }

        // 9. Store file changes BEFORE finalizing the message so the frontend
        //    sees both the changes field and the fileChanges record atomically.
        if (finalFilesMap.size > 0) {
          // Find paths where we don't have original content for diff display
          const missingPaths = [...finalFilesMap.keys()].filter(
            (p) => originalFileContents[p] === undefined,
          );

          if (missingPaths.length > 0 && repo) {
            if (runtimeInfo) {
              await Promise.all(
                missingPaths.map(async (p) => {
                  try {
                    const result = await execCommandInRuntime(
                      runtimeInfo,
                      `cat '${p}'`,
                      10000,
                    );
                    if (result.exitCode === 0 && result.output !== undefined) {
                      originalFileContents[p] = result.output;
                    }
                  } catch {
                    // File doesn't exist in runtime -- it's genuinely new
                  }
                }),
              );
            } else {
              try {
                const userToken = await getUserGithubToken(ctx);
                const octokit = new Octokit({
                  auth: userToken || process.env.GITHUB_TOKEN,
                });
                const branch = session?.branchName ?? repo.defaultBranch;
                await Promise.all(
                  missingPaths.map(async (p) => {
                    try {
                      const { data } = await octokit.repos.getContent({
                        owner: repo.githubOwner,
                        repo: repo.githubRepo,
                        path: p,
                        ref: branch,
                      });
                      if ("content" in data && data.encoding === "base64") {
                        originalFileContents[p] = Buffer.from(
                          data.content,
                          "base64",
                        ).toString("utf-8");
                      }
                    } catch {
                      // File doesn't exist on GitHub -- it's genuinely new
                    }
                  }),
                );
              } catch {
                // GitHub auth/access failed, leave as undefined (will show as new)
              }
            }
          }

          const filesWithOriginals = [...finalFilesMap.entries()].map(([path, content]) => ({
            path,
            content,
            originalContent: originalFileContents[path] ?? undefined,
          }));
          fileChangeId = await ctx.runMutation(internal.fileChanges.saveFileChanges, {
            sessionId: args.sessionId,
            messageId,
            files: filesWithOriginals,
            ...(runtimeInfo ? { applied: true } : {}),
          });
        }

        // 10. Finalize the streaming message (after file changes are saved)
        await ctx.runMutation(api.messages.finalizeStreamingMessage, {
          messageId,
          content: finalContent,
          rawOutput: lastFullText,
          ...(changedPaths.length > 0
            ? { changes: { files: changedPaths, committed: false } }
            : {}),
        });

        // 11. Auto-commit to the session branch if one is configured
        if (fileChangeId && repo && session?.branchName && !wasStopped) {
          try {
            const firstLine = (finalContent.split("\n")[0] ?? "Update files").slice(0, 72);
            const commitMessage = `Composure: ${firstLine.replace(/\*\*/g, "").replace(/[`#]/g, "").trim()}`;
            await ctx.runAction(internal.github.autoCommitToBranch, {
              repoId: session.repoId,
              messageId,
              fileChangeId,
              branchName: session.branchName,
              commitMessage,
            });
            console.log(`[AI] Auto-committed to branch ${session.branchName}`);
          } catch (pushErr) {
            console.error("[AI] Auto-commit to branch failed:", pushErr);
          }
        }

        // 12. Fallback: if no repo context, also handle old HTML preview approach
        if (!repo) {
          const htmlMatch = lastFullText.match(
            /<html-preview>([\s\S]*?)<\/html-preview>/,
          );
          if (htmlMatch?.[1]) {
            await ctx.runMutation(api.sessions.updatePreviewCode, {
              sessionId: args.sessionId,
              previewCode: htmlMatch[1].trim(),
            });
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await ctx.runMutation(api.messages.finalizeStreamingMessage, {
          messageId,
          content: `Sorry, I ran into an error generating a response: ${errorMessage}`,
          changes: { files: [], committed: false },
        });
        await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId }).catch(() => { });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.messages.send, {
        sessionId: args.sessionId,
        role: "assistant",
        content: `Sorry, I ran into an error generating a response: ${errorMessage}`,
      });
      await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId }).catch(() => { });
    }
  },
});

// ---------------------------------------------------------------------------
// Claude CLI-based generation (runs inside Docker container)
// ---------------------------------------------------------------------------

const CLI_POLL_INTERVAL = 2000;
const CLI_MAX_WAIT = 10 * 60 * 1000; // 10 minutes

export const generateResponseViaCli = action({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.runQuery(api.messages.list, {
      sessionId: args.sessionId,
    });
    const recentMessages = messages.slice(-10);

    try {
      const session = await ctx.runQuery(api.sessions.get, {
        sessionId: args.sessionId,
      });
      const repo = session
        ? await ctx.runQuery(api.projects.get, { repoId: session.repoId })
        : null;
      const team = repo
        ? await ctx.runQuery(internal.teams.getTeamInternal, {
          teamId: repo.teamId,
        })
        : null;

      // Resolve model and API key
      const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-6";
      let modelName: string = DEFAULT_ANTHROPIC_MODEL;
      if (team?.llmProvider === "anthropic" && team?.llmModel) {
        modelName = team.llmModel;
      }
      const anthropicApiKey =
        (team?.llmProvider === "anthropic" && team?.llmApiKey) ? team.llmApiKey
        : process.env.CLAUDE_API_KEY || "";

      // Resolve runtime -- must be docker
      const runtimeInfo = await resolveRuntimeExecInfo(ctx, repo, args.sessionId);
      if (!runtimeInfo || runtimeInfo.type !== "docker") {
        throw new Error("Claude CLI generation requires a running Docker container");
      }

      // Create streaming message placeholder
      const messageId = await ctx.runMutation(
        api.messages.createStreamingMessage,
        { sessionId: args.sessionId },
      );

      try {
        // Build prompt with conversation history
        const promptParts: string[] = [];
        if (recentMessages.length > 1) {
          promptParts.push("Recent conversation:");
          for (const msg of recentMessages.slice(0, -1)) {
            const role = msg.role === "user" ? "User" : "Assistant";
            promptParts.push(`${role}: ${msg.content}`);
          }
          promptParts.push("");
        }
        const lastMsg = recentMessages[recentMessages.length - 1];
        if (lastMsg) {
          promptParts.push(lastMsg.content);
        }

        const prompt = promptParts.join("\n");
        const promptBase64 = Buffer.from(prompt).toString("base64");

        // Write prompt file to container
        await execCommandInRuntime(
          runtimeInfo,
          `printf '%s' '${promptBase64}' | base64 -d > /tmp/claude-prompt.txt`,
          30000,
        );

        // Clean up any previous run artifacts
        await execCommandInRuntime(
          runtimeInfo,
          "rm -f /tmp/claude-output.jsonl /tmp/claude-pid.txt",
          10000,
        );

        // Ensure Claude CLI is installed
        const whichResult = await execCommandInRuntime(
          runtimeInfo,
          "which claude 2>/dev/null || echo 'NOT_FOUND'",
          10000,
        );
        if (whichResult.output.trim() === "NOT_FOUND" || whichResult.exitCode !== 0) {
          console.log("[CLI] Claude CLI not found, installing...");
          await ctx.runMutation(api.messages.updateStreamingContent, {
            messageId,
            content: "Installing Claude CLI...",
          });
          await execCommandInRuntime(
            runtimeInfo,
            "npm install -g @anthropic-ai/claude-code 2>&1",
            120000,
          );
          // Skip onboarding prompts (configure for non-root node user)
          await execCommandInRuntime(
            runtimeInfo,
            `mkdir -p /home/node/.claude && echo '{"hasCompletedOnboarding":true}' > /home/node/.claude/settings.json && chown -R node:node /home/node/.claude`,
            10000,
          );
          console.log("[CLI] Claude CLI installed");
        }

        // Ensure node user can read/write project files and tmp artifacts
        await execCommandInRuntime(
          runtimeInfo,
          `chown -R node:node /app && chmod 644 /tmp/claude-prompt.txt`,
          60000,
        );

        // Mark /app as safe so root-user git commands work after chown to node
        await execCommandInRuntime(
          runtimeInfo,
          "git config --global --add safe.directory /app",
          10000,
        );

        // Snapshot the HEAD commit before Claude runs so we can diff against it
        // even if Claude commits changes itself
        const headBefore = await execCommandInRuntime(
          runtimeInfo,
          "git rev-parse HEAD",
          10000,
        );
        const initialSha = headBefore.output.trim();
        console.log(`[CLI] Initial HEAD SHA: ${initialSha}`);

        // Launch Claude CLI as non-root node user (--dangerously-skip-permissions requires non-root)
        const launchCmd = `runuser -u node -- bash -c 'ANTHROPIC_API_KEY=${anthropicApiKey} claude -p --dangerously-skip-permissions --output-format stream-json --verbose --model ${modelName} < /tmp/claude-prompt.txt > /tmp/claude-output.jsonl 2>&1 & echo $!'`;

        const launchResult = await execCommandInRuntime(runtimeInfo, launchCmd, 30000);
        const pid = launchResult.output.trim();
        if (!pid || !/^\d+$/.test(pid)) {
          throw new Error(`Failed to launch Claude CLI, got: ${launchResult.output}`);
        }

        console.log(`[CLI] Claude CLI started with PID ${pid}`);

        // Polling loop
        let byteOffset = 1; // tail -c +N is 1-based
        let accumulatedLog = "";
        let userFacingText = "";
        const cliErrors: string[] = [];
        let wasStopped = false;
        let cliSuccess: boolean | null = null;
        const startTime = Date.now();

        while (Date.now() - startTime < CLI_MAX_WAIT) {
          await new Promise((resolve) => setTimeout(resolve, CLI_POLL_INTERVAL));

          // Check stop requested
          const s = await ctx.runQuery(api.sessions.get, { sessionId: args.sessionId });
          if (s?.stopRequested) {
            console.log("[CLI] Stop requested, killing process");
            await execCommandInRuntime(runtimeInfo, `kill ${pid} 2>/dev/null || true`, 10000);
            wasStopped = true;
            break;
          }

          // Read new output + check if still running (single exec for efficiency)
          const pollResult = await execCommandInRuntime(
            runtimeInfo,
            `tail -c +${byteOffset} /tmp/claude-output.jsonl 2>/dev/null; echo "---SEPARATOR---"; kill -0 ${pid} 2>/dev/null && echo "RUNNING" || echo "DONE"`,
            15000,
          );

          const separatorIdx = pollResult.output.lastIndexOf("---SEPARATOR---");
          const newData = separatorIdx >= 0
            ? pollResult.output.substring(0, separatorIdx)
            : "";
          const statusLine = separatorIdx >= 0
            ? pollResult.output.substring(separatorIdx + "---SEPARATOR---".length).trim()
            : "DONE";

          if (newData.length > 0) {
            byteOffset += Buffer.byteLength(newData, "utf-8");
            accumulatedLog += newData;

            // Parse stream-json lines for user-facing content
            const lines = newData.split("\n").filter((l) => l.trim());
            for (const line of lines) {
              try {
                const event = JSON.parse(line);
                if (event.type === "assistant" && event.message?.content) {
                  for (const block of event.message.content) {
                    if (block.type === "text") {
                      userFacingText += block.text;
                    }
                  }
                } else if (event.type === "content_block_delta" && event.delta?.text) {
                  userFacingText += event.delta.text;
                } else if (event.type === "result") {
                  if (event.result) {
                    userFacingText = event.result;
                  }
                  cliSuccess = event.subtype === "success" && event.is_error === false;
                }
              } catch {
                cliErrors.push(line);
              }
            }

            // Update streaming content for chat bubble
            if (userFacingText) {
              await ctx.runMutation(api.messages.updateStreamingContent, {
                messageId,
                content: userFacingText,
              });
            } else if (cliErrors.length > 0) {
              const errorText = cliErrors.join("\n").trim();
              await ctx.runMutation(api.messages.updateStreamingContent, {
                messageId,
                content: `Claude CLI error:\n\`\`\`\n${errorText}\n\`\`\``,
              });
            } else {
              await ctx.runMutation(api.messages.updateStreamingContent, {
                messageId,
                content: "Claude is working...",
              });
            }

            // Update raw output for LLM logs tab
            await ctx.runMutation(api.messages.updateStreamingRawOutput, {
              messageId,
              rawOutput: accumulatedLog,
            });
          }

          // The result event is the definitive end signal from Claude CLI.
          // Break immediately — the process may hang after outputting it.
          if (cliSuccess !== null) {
            console.log(`[CLI] Received result event (success=${cliSuccess}), finishing`);
            // Kill the process in case it's still alive (don't wait)
            execCommandInRuntime(runtimeInfo, `kill ${pid} 2>/dev/null || true`, 10000).catch(() => {});
            break;
          }

          if (statusLine === "DONE") {
            console.log("[CLI] Claude CLI process exited");
            break;
          }
        }

        // Final read of any remaining output
        const finalRead = await execCommandInRuntime(
          runtimeInfo,
          `tail -c +${byteOffset} /tmp/claude-output.jsonl 2>/dev/null || true`,
          15000,
        );
        if (finalRead.output.trim()) {
          accumulatedLog += finalRead.output;

          const lines = finalRead.output.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.type === "result") {
                if (event.result) {
                  userFacingText = event.result;
                }
                cliSuccess = event.subtype === "success" && event.is_error === false;
              } else if (event.type === "content_block_delta" && event.delta?.text) {
                userFacingText += event.delta.text;
              }
            } catch {
              cliErrors.push(line);
            }
          }
        }

        // Clear stop flag
        await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId });

        // Detect file changes via git — run diagnostics first to understand
        // the state, then collect changed file paths.
        const [statusResult, diffResult, logResult] = await Promise.all([
          execCommandInRuntime(runtimeInfo, "git status --porcelain 2>&1", 15000).catch((e) => ({ exitCode: -1, output: `error: ${e}` })),
          execCommandInRuntime(runtimeInfo, initialSha !== "NONE" ? `git diff --name-only ${initialSha} 2>&1` : "git diff --name-only HEAD 2>&1", 15000).catch((e) => ({ exitCode: -1, output: `error: ${e}` })),
          execCommandInRuntime(runtimeInfo, initialSha !== "NONE" ? `git log --oneline ${initialSha}..HEAD 2>&1` : "echo no-initial-sha", 15000).catch((e) => ({ exitCode: -1, output: `error: ${e}` })),
        ]);
        console.log(`[CLI] git status --porcelain (exit=${statusResult.exitCode}): ${JSON.stringify(statusResult.output.slice(0, 500))}`);
        console.log(`[CLI] git diff --name-only (exit=${diffResult.exitCode}): ${JSON.stringify(diffResult.output.slice(0, 500))}`);
        console.log(`[CLI] git log (exit=${logResult.exitCode}): ${JSON.stringify(logResult.output.slice(0, 500))}`);

        // Collect changed paths from all sources: working tree changes (status),
        // tree diff vs initial SHA, and untracked files.
        const pathSet = new Set<string>();

        // From git status --porcelain (uncommitted + untracked)
        for (const line of statusResult.output.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("fatal:")) continue;
          // porcelain format: XY filename  (first 3 chars are status + space)
          const filePath = trimmed.slice(3).trim().replace(/^"(.*)"$/, "$1");
          if (filePath) pathSet.add(filePath);
        }

        // From git diff --name-only (covers committed changes since initial SHA)
        if (diffResult.exitCode === 0) {
          for (const line of diffResult.output.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("fatal:") && !trimmed.startsWith("warning:")) {
              pathSet.add(trimmed);
            }
          }
        }

        const changedPaths = [...pathSet];
        console.log(`[CLI] Final detected: ${changedPaths.length} changed files, cliSuccess=${cliSuccess}, paths=${JSON.stringify(changedPaths.slice(0, 10))}`);

        // Read changed file contents and originals for diff
        let fileChangeId: Id<"fileChanges"> | null = null;
        if (changedPaths.length > 0) {
          const filesWithOriginals: { path: string; content: string; originalContent?: string }[] = [];
          const origRef = initialSha !== "NONE" ? initialSha : "HEAD";

          await Promise.all(
            changedPaths.map(async (filePath) => {
              const [currentResult, originalResult] = await Promise.all([
                execCommandInRuntime(runtimeInfo, `cat '${filePath}'`, 10000).catch(() => null),
                execCommandInRuntime(runtimeInfo, `git show ${origRef}:'${filePath}' 2>/dev/null`, 10000).catch(() => null),
              ]);

              if (currentResult && currentResult.exitCode === 0) {
                filesWithOriginals.push({
                  path: filePath,
                  content: currentResult.output,
                  ...(originalResult && originalResult.exitCode === 0
                    ? { originalContent: originalResult.output }
                    : {}),
                });
              }
            }),
          );

          if (filesWithOriginals.length > 0) {
            fileChangeId = await ctx.runMutation(internal.fileChanges.saveFileChanges, {
              sessionId: args.sessionId,
              messageId,
              files: filesWithOriginals,
              applied: true,
            });
          }
        }

        // Build final content
        let finalContent: string;
        if (wasStopped) {
          finalContent = userFacingText
            ? userFacingText + "\n\n*(Stopped)*"
            : "*(Stopped)*";
        } else if (userFacingText) {
          finalContent = userFacingText;
        } else if (cliErrors.length > 0) {
          const errorText = cliErrors.join("\n").trim();
          finalContent = `Claude CLI error:\n\`\`\`\n${errorText}\n\`\`\``;
          console.error("[CLI] Claude CLI errored:", errorText);
        } else {
          finalContent = "Done.";
        }

        // Finalize the streaming message
        await ctx.runMutation(api.messages.finalizeStreamingMessage, {
          messageId,
          content: finalContent,
          rawOutput: accumulatedLog,
          ...(changedPaths.length > 0
            ? { changes: { files: changedPaths, committed: false } }
            : {}),
        });

        // Auto-commit to branch on success only
        console.log(`[CLI] Auto-commit check: fileChangeId=${!!fileChangeId}, repo=${!!repo}, session=${!!session}, cliSuccess=${cliSuccess}, wasStopped=${wasStopped}, branchName=${session?.branchName ?? "(none)"}`);
        if (fileChangeId && repo && session && cliSuccess === true && !wasStopped) {
          try {
            let branchName = session.branchName;
            if (!branchName) {
              const slug = (session.featureName ?? "changes")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40);
              branchName = `composure/${slug}-${session._id.slice(-6)}`;
              await ctx.runMutation(api.sessions.setBranchName, {
                sessionId: args.sessionId,
                branchName,
              });
              console.log(`[CLI] Generated branch name: ${branchName}`);
            }

            const firstLine = (finalContent.split("\n")[0] ?? "Update files").slice(0, 72);
            const commitMessage = `Composure: ${firstLine.replace(/\*\*/g, "").replace(/[`#]/g, "").trim()}`;
            const prTitle = session.featureName
              ? `Composure: ${session.featureName}`
              : commitMessage;
            await ctx.runAction(internal.github.autoCommitToBranch, {
              repoId: session.repoId,
              messageId,
              fileChangeId,
              branchName,
              commitMessage,
              prTitle,
            });
            console.log(`[CLI] Auto-committed to branch ${branchName}`);
          } catch (pushErr) {
            console.error("[CLI] Auto-commit to branch failed:", pushErr);
          }
        } else if (fileChangeId && !cliSuccess) {
          console.log("[CLI] Skipping auto-commit — CLI did not exit with success");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await ctx.runMutation(api.messages.finalizeStreamingMessage, {
          messageId,
          content: `Sorry, I ran into an error: ${errorMessage}`,
          changes: { files: [], committed: false },
        });
        await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId }).catch(() => { });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.messages.send, {
        sessionId: args.sessionId,
        role: "assistant",
        content: `Sorry, I ran into an error: ${errorMessage}`,
      });
      await ctx.runMutation(api.sessions.clearStop, { sessionId: args.sessionId }).catch(() => { });
    }
  },
});
