"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
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

async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);
  return profile?.githubAccessToken ?? undefined;
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
  const contentsBlock = Object.entries(fileContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");

  return `You are Artie, an AI web development assistant. You modify files in the user's project to implement their requests.

The project's file tree:
${fileTree}

Current file contents:
${contentsBlock}

When you need to modify files, respond with:
1. A brief explanation of the changes
2. The complete updated file contents for each file you're changing

Format your response like this:
<explanation>
Brief description of what you changed and why
</explanation>

<file path="src/components/Button.tsx">
// complete file contents here
</file>

<file path="src/styles/main.css">
/* complete file contents here */
</file>

Rules:
- Always output the COMPLETE file content, not just diffs
- Only include files you're actually changing
- Keep changes minimal and focused on the user's request
- Maintain the existing code style
- If the user's request doesn't require file changes, just respond with an <explanation> block`;
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

function parseExplanation(text: string): string {
  const match = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  return match?.[1]?.trim() ?? text;
}

function extractDisplayContent(text: string): string {
  const explMatch = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (explMatch) {
    const afterExpl = text.slice(
      text.indexOf("</explanation>") + "</explanation>".length,
    );
    const hasFileStart = afterExpl.includes("<file");
    let content = explMatch[1].trim();
    if (hasFileStart) {
      content += "\n\n*Editing files...*";
    }
    return content;
  }
  const cleaned = text
    .replace(/<[^>]*$/, "")
    .replace(/<explanation>/g, "")
    .trim();
  return cleaned || "Thinking...";
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

      const defaultModel = () =>
        createAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        })("claude-sonnet-4-20250514");

      if (team?.llmProvider && team?.llmApiKey) {
        switch (team.llmProvider) {
          case "openai":
            model = createOpenAI({ apiKey: team.llmApiKey })(
              team.llmModel || "gpt-4",
            );
            break;
          case "anthropic":
            model = createAnthropic({ apiKey: team.llmApiKey })(
              team.llmModel || "claude-sonnet-4-20250514",
            );
            break;
          case "google":
            model = createGoogleGenerativeAI({ apiKey: team.llmApiKey })(
              team.llmModel || "gemini-pro",
            );
            break;
          default:
            model = defaultModel();
        }
      } else {
        model = defaultModel();
      }

      // 3. Fetch repo file tree and context files from GitHub
      let systemPrompt: string;
      let repoFileContents: Record<string, string> = {};
      if (repo) {
        const userToken = await getUserGithubToken(ctx);
        const octokit = new Octokit({ auth: userToken || process.env.GITHUB_TOKEN });

        const { data: treeData } = await octokit.git.getTree({
          owner: repo.githubOwner,
          repo: repo.githubRepo,
          tree_sha: repo.defaultBranch,
          recursive: "1",
        });

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

        const fileTreeStr = tree
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
        const fileContents: Record<string, string> = {};
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
                  ref: repo.defaultBranch,
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

        systemPrompt = buildSystemPrompt(fileTreeStr, fileContents);
        repoFileContents = fileContents;
      } else {
        // Fallback: no repo connected, use the old HTML-generation prompt
        systemPrompt = `You are Artie, an AI web development assistant. Users describe what they want to see, and you build it as a single HTML page with inline CSS and JavaScript.

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
        // 5. Call the LLM with streaming
        const result = streamText({
          model,
          system: systemPrompt,
          messages: recentMessages.map(
            (m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }),
          ),
        });

        // 6. Collect chunks and periodically flush to the database
        let accumulated = "";
        let lastFlush = Date.now();
        const FLUSH_INTERVAL = 300;
        const MIN_FLUSH_CHARS = 50;

        for await (const chunk of result.textStream) {
          accumulated += chunk;

          const now = Date.now();
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

        // 7. Parse full response
        const fullText = accumulated;
        const explanation = parseExplanation(fullText);
        const fileChanges = parseFileBlocks(fullText);
        const changedPaths = fileChanges.map((f) => f.path);

        // 8. Finalize the streaming message
        await ctx.runMutation(api.messages.finalizeStreamingMessage, {
          messageId,
          content: explanation,
          ...(changedPaths.length > 0
            ? { changes: { files: changedPaths, committed: false } }
            : {}),
        });

        // 9. Store file changes in the fileChanges table (with originals for revert)
        if (fileChanges.length > 0) {
          const filesWithOriginals = fileChanges.map((f) => ({
            path: f.path,
            content: f.content,
            originalContent: repoFileContents[f.path] ?? undefined,
          }));
          await ctx.runMutation(internal.fileChanges.saveFileChanges, {
            sessionId: args.sessionId,
            messageId,
            files: filesWithOriginals,
          });
        }

        // 10. Fallback: if no repo context, also handle old HTML preview approach
        if (!repo) {
          const htmlMatch = fullText.match(
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
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.messages.send, {
        sessionId: args.sessionId,
        role: "assistant",
        content: `Sorry, I ran into an error generating a response: ${errorMessage}`,
      });
    }
  },
});
