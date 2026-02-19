"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Docker File Operations
 *
 * These actions handle file operations and command execution
 * within Docker containers via the host API's exec endpoint.
 * File content is transmitted via base64 encoding through shell commands.
 */

const DOCKER_HOST = process.env.DOCKER_HOST_URL!;

// Type for container returned from queries
interface DockerContainerData {
  _id: Id<"dockerContainers">;
  containerId?: string;
  status: string;
}

// Helper to get container and validate it's ready for API calls
async function getContainerForApi(
  ctx: ActionCtx,
  containerId: Id<"dockerContainers">,
): Promise<{ hostContainerId: string; status: string }> {
  const container = (await ctx.runQuery(
    internal.dockerContainers.getByIdInternal,
    { containerId },
  )) as DockerContainerData | null;

  if (!container) {
    throw new Error("Docker container not found");
  }

  if (container.status !== "ready" && container.status !== "active") {
    throw new Error(`Docker container is not ready (status: ${container.status})`);
  }

  if (!container.containerId) {
    throw new Error("Docker container has no host container ID");
  }

  return {
    hostContainerId: container.containerId,
    status: container.status,
  };
}

// Execute a command in a Docker container via the host API
async function execInContainer(
  hostContainerId: string,
  command: string,
  timeout: number = 60000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const apiSecret = process.env.DOCKER_API_SECRET;
  if (!apiSecret) {
    throw new Error("DOCKER_API_SECRET not configured");
  }

  const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), timeout + 10000);

  try {
    const response = await fetch(`${hostUrl}/api/containers/${hostContainerId}/exec`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, timeout }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Exec failed: ${error}`);
    }

    return (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Command timed out after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(fetchTimeout);
  }
}

// Apply file changes from a fileChange record to a Docker container
export const applyFileChanges = action({
  args: {
    containerId: v.id("dockerContainers"),
    fileChangeId: v.id("fileChanges"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const container = await getContainerForApi(ctx, args.containerId);

    const fileChange = await ctx.runQuery(api.fileChanges.getById, {
      fileChangeId: args.fileChangeId,
    });

    if (!fileChange) {
      return { success: false, error: "File change not found" };
    }

    if (fileChange.applied) {
      return { success: true };
    }

    if (fileChange.reverted) {
      return { success: false, error: "File change was reverted" };
    }

    try {
      const results = await Promise.all(
        fileChange.files.map(async (file) => {
          const base64Content = Buffer.from(file.content).toString("base64");
          const dirPath = file.path.includes("/")
            ? file.path.substring(0, file.path.lastIndexOf("/"))
            : "";
          const mkdirCmd = dirPath
            ? `mkdir -p /app/${dirPath} && `
            : "";
          const command = `${mkdirCmd}echo '${base64Content}' | base64 -d > /app/${file.path}`;

          try {
            const result = await execInContainer(container.hostContainerId, command);
            if (result.exitCode !== 0) {
              return {
                path: file.path,
                error: result.stderr || `Exit code: ${result.exitCode}`,
              };
            }
            return { path: file.path, error: null };
          } catch (err) {
            return {
              path: file.path,
              error: err instanceof Error ? err.message : "Unknown error",
            };
          }
        }),
      );

      const errors = results.filter((r) => r.error !== null);
      if (errors.length > 0) {
        const errorMsg = errors
          .map((e) => `${e.path}: ${e.error}`)
          .join(", ");
        await ctx.runMutation(api.fileChanges.markFailed, {
          fileChangeId: args.fileChangeId,
          error: errorMsg,
        });
        return { success: false, error: errorMsg };
      }

      await ctx.runMutation(api.fileChanges.markApplied, {
        fileChangeId: args.fileChangeId,
      });

      return { success: true };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.fileChanges.markFailed, {
        fileChangeId: args.fileChangeId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  },
});

// Execute a bash command from a bashCommand record in a Docker container
export const executeBashCommand = action({
  args: {
    containerId: v.id("dockerContainers"),
    bashCommandId: v.id("bashCommands"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    exitCode?: number;
    output?: string;
    error?: string;
  }> => {
    const container = await getContainerForApi(ctx, args.containerId);

    const bashCommand = await ctx.runQuery(api.bashCommands.getByIdInternal, {
      bashCommandId: args.bashCommandId,
    });

    if (!bashCommand) {
      return { success: false, error: "Bash command not found" };
    }

    if (bashCommand.status === "completed" || bashCommand.status === "failed") {
      return {
        success: bashCommand.status === "completed",
        exitCode: bashCommand.exitCode,
        output: bashCommand.output,
        error: bashCommand.error,
      };
    }

    try {
      await ctx.runMutation(api.bashCommands.markRunning, {
        bashCommandId: args.bashCommandId,
      });

      const command = `cd /app && ${bashCommand.command}`;
      const result = await execInContainer(container.hostContainerId, command, 120000);

      const output = (result.stdout || "") + (result.stderr || "");

      await ctx.runMutation(api.bashCommands.markCompleted, {
        bashCommandId: args.bashCommandId,
        output,
        exitCode: result.exitCode,
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.bashCommands.markFailed, {
        bashCommandId: args.bashCommandId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  },
});
