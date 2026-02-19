"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Droplet File Operations
 * 
 * These actions handle file operations and command execution
 * within DigitalOcean Droplet containers via their HTTP API.
 */

// Type for droplet returned from the API
interface DropletData {
  _id: Id<"droplets">;
  apiUrl?: string;
  apiSecret?: string;
  status: string;
}

// Helper to get droplet and validate it's ready for API calls
async function getDropletForApi(
  ctx: ActionCtx,
  dropletId: Id<"droplets">
): Promise<{ apiUrl: string; apiSecret: string; status: string }> {
  const droplet = await ctx.runQuery(api.droplets.getById, { dropletId }) as DropletData | null;

  if (!droplet) {
    throw new Error("Droplet not found");
  }

  if (droplet.status !== "ready" && droplet.status !== "active") {
    throw new Error(`Droplet is not ready (status: ${droplet.status})`);
  }

  if (!droplet.apiUrl || !droplet.apiSecret) {
    throw new Error("Droplet API not configured");
  }

  return {
    apiUrl: droplet.apiUrl,
    apiSecret: droplet.apiSecret,
    status: droplet.status,
  };
}

// Write files to the Droplet container
export const writeFiles = action({
  args: {
    dropletId: v.id("droplets"),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ success: boolean; errors?: string[] }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    try {
      const response = await fetch(`${droplet.apiUrl}/files/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
        body: JSON.stringify({ files: args.files }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to write files: ${error}`);
      }

      const result = await response.json();

      if (result.errors && result.errors.length > 0) {
        return {
          success: false,
          errors: result.errors.map((e: { path: string; error: string }) => `${e.path}: ${e.error}`),
        };
      }

      return { success: true };
    } catch (error) {
      console.error("[writeFiles] Error:", error);
      throw error;
    }
  },
});

// Read a single file from the Droplet container
export const readFile = action({
  args: {
    dropletId: v.id("droplets"),
    path: v.string(),
  },
  handler: async (ctx, args): Promise<{ content: string } | { error: string }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    try {
      const response = await fetch(
        `${droplet.apiUrl}/files/read?path=${encodeURIComponent(args.path)}`,
        {
          headers: {
            Authorization: `Bearer ${droplet.apiSecret}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { error: "File not found" };
        }
        const error = await response.text();
        return { error };
      }

      const result = await response.json();
      return { content: result.content };
    } catch (error) {
      console.error("[readFile] Error:", error);
      return { error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Get the file tree from the Droplet container
export const getFileTree = action({
  args: {
    dropletId: v.id("droplets"),
  },
  handler: async (ctx, args): Promise<{
    files: Array<{ path: string; size: number }>;
  }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    try {
      const response = await fetch(`${droplet.apiUrl}/files/tree`, {
        headers: {
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get file tree: ${error}`);
      }

      const result = await response.json();
      return { files: result.files };
    } catch (error) {
      console.error("[getFileTree] Error:", error);
      throw error;
    }
  },
});

// Execute a bash command in the Droplet container
export const execCommand = action({
  args: {
    dropletId: v.id("droplets"),
    command: v.string(),
    timeout: v.optional(v.number()), // Timeout in ms (default 60000)
  },
  handler: async (ctx, args): Promise<{
    exitCode: number;
    output: string;
    timedOut?: boolean;
  }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    try {
      const response = await fetch(`${droplet.apiUrl}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
        body: JSON.stringify({
          command: args.command,
          timeout: args.timeout ?? 60000,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to execute command: ${error}`);
      }

      const result = await response.json();
      return {
        exitCode: result.exitCode,
        output: result.output,
        timedOut: result.timedOut,
      };
    } catch (error) {
      console.error("[execCommand] Error:", error);
      throw error;
    }
  },
});

// Apply file changes from a fileChange record to the Droplet container
export const applyFileChanges = action({
  args: {
    dropletId: v.id("droplets"),
    fileChangeId: v.id("fileChanges"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    // Get the file change record
    const fileChange = await ctx.runQuery(api.fileChanges.getById, {
      fileChangeId: args.fileChangeId,
    });

    if (!fileChange) {
      return { success: false, error: "File change not found" };
    }

    if (fileChange.applied) {
      return { success: true }; // Already applied
    }

    if (fileChange.reverted) {
      return { success: false, error: "File change was reverted" };
    }

    try {
      const response = await fetch(`${droplet.apiUrl}/files/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
        body: JSON.stringify({
          files: fileChange.files.map((f) => ({
            path: f.path,
            content: f.content,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        await ctx.runMutation(api.fileChanges.markFailed, {
          fileChangeId: args.fileChangeId,
          error,
        });
        return { success: false, error };
      }

      const result = await response.json();

      if (result.errors && result.errors.length > 0) {
        const errorMsg = result.errors
          .map((e: { path: string; error: string }) => `${e.path}: ${e.error}`)
          .join(", ");
        await ctx.runMutation(api.fileChanges.markFailed, {
          fileChangeId: args.fileChangeId,
          error: errorMsg,
        });
        return { success: false, error: errorMsg };
      }

      // Mark as applied
      await ctx.runMutation(api.fileChanges.markApplied, {
        fileChangeId: args.fileChangeId,
      });

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.fileChanges.markFailed, {
        fileChangeId: args.fileChangeId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  },
});

// Execute a bash command from a bashCommand record in the Droplet container
export const executeBashCommand = action({
  args: {
    dropletId: v.id("droplets"),
    bashCommandId: v.id("bashCommands"),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    exitCode?: number;
    output?: string;
    error?: string;
  }> => {
    const droplet = await getDropletForApi(ctx, args.dropletId);

    // Get the bash command record
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
      // Mark as running
      await ctx.runMutation(api.bashCommands.markRunning, {
        bashCommandId: args.bashCommandId,
      });

      // Execute in the container's /app directory
      const command = `cd /app && ${bashCommand.command}`;
      const response = await fetch(`${droplet.apiUrl}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
        body: JSON.stringify({
          command,
          timeout: 120000, // 2 minute timeout for commands
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        await ctx.runMutation(api.bashCommands.markFailed, {
          bashCommandId: args.bashCommandId,
          error,
        });
        return { success: false, error };
      }

      const result = await response.json();

      // Mark as completed or failed based on exit code
      await ctx.runMutation(api.bashCommands.markCompleted, {
        bashCommandId: args.bashCommandId,
        output: result.output,
        exitCode: result.exitCode,
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output: result.output,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(api.bashCommands.markFailed, {
        bashCommandId: args.bashCommandId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  },
});
