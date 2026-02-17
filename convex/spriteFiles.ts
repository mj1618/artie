"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Sprite File Operations
 * 
 * These actions handle file operations and command execution
 * within Fly.io Sprite containers via their HTTP API.
 */

// Type for sprite returned from the API
interface SpriteData {
  _id: Id<"flyioSprites">;
  apiUrl?: string;
  apiSecret?: string;
  status: "provisioning" | "deploying" | "running" | "stopping" | "stopped" | "error";
  cloneStatus?: "pending" | "cloning" | "installing" | "ready" | "failed";
  appName: string;
}

// Helper to get sprite and validate it's ready for API calls
async function getSpriteForApi(
  ctx: ActionCtx,
  spriteId: Id<"flyioSprites">
): Promise<{ apiUrl: string; apiSecret: string; status: string; cloneStatus: string | undefined }> {
  const sprite = await ctx.runQuery(api.flyioSprites.getById, { spriteId }) as SpriteData | null;

  if (!sprite) {
    throw new Error("Sprite not found");
  }

  if (sprite.status !== "running") {
    throw new Error(`Sprite is not running (status: ${sprite.status})`);
  }

  if (!sprite.apiUrl || !sprite.apiSecret) {
    throw new Error("Sprite API not configured");
  }

  return {
    apiUrl: sprite.apiUrl,
    apiSecret: sprite.apiSecret,
    status: sprite.status,
    cloneStatus: sprite.cloneStatus,
  };
}

// Write files to the Sprite container
export const writeFiles = action({
  args: {
    spriteId: v.id("flyioSprites"),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ success: boolean; errors?: string[] }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      const response = await fetch(`${sprite.apiUrl}/files/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sprite.apiSecret}`,
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

// Read a single file from the Sprite container
export const readFile = action({
  args: {
    spriteId: v.id("flyioSprites"),
    path: v.string(),
  },
  handler: async (ctx, args): Promise<{ content: string } | { error: string }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      const response = await fetch(
        `${sprite.apiUrl}/files/read?path=${encodeURIComponent(args.path)}`,
        {
          headers: {
            Authorization: `Bearer ${sprite.apiSecret}`,
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

// Read multiple files from the Sprite container
export const readFiles = action({
  args: {
    spriteId: v.id("flyioSprites"),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{
    files: Array<{ path: string; content?: string; error?: string }>;
  }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      const response = await fetch(`${sprite.apiUrl}/files/read-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sprite.apiSecret}`,
        },
        body: JSON.stringify({ paths: args.paths }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to read files: ${error}`);
      }

      const result = await response.json();
      return { files: result.files };
    } catch (error) {
      console.error("[readFiles] Error:", error);
      throw error;
    }
  },
});

// Get the file tree from the Sprite container
export const getFileTree = action({
  args: {
    spriteId: v.id("flyioSprites"),
    maxSize: v.optional(v.number()), // Max file size to include (default 100KB)
  },
  handler: async (ctx, args): Promise<{
    files: Array<{ path: string; size: number; isText: boolean }>;
  }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      const maxSize = args.maxSize ?? 100000;
      const response = await fetch(
        `${sprite.apiUrl}/files/tree?maxSize=${maxSize}`,
        {
          headers: {
            Authorization: `Bearer ${sprite.apiSecret}`,
          },
        }
      );

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

// Execute a bash command in the Sprite container
export const execCommand = action({
  args: {
    spriteId: v.id("flyioSprites"),
    command: v.string(),
    timeout: v.optional(v.number()), // Timeout in ms (default 60000)
  },
  handler: async (ctx, args): Promise<{
    exitCode: number;
    output: string;
    timedOut?: boolean;
  }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      const response = await fetch(`${sprite.apiUrl}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sprite.apiSecret}`,
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

// Check the health/ready status of the Sprite container
export const checkHealth = action({
  args: {
    spriteId: v.id("flyioSprites"),
  },
  handler: async (ctx, args): Promise<{
    healthy: boolean;
    cloneReady: boolean;
    uptime?: number;
    error?: string;
  }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

    try {
      // Check health endpoint
      const healthResponse = await fetch(`${sprite.apiUrl}/health`, {
        headers: {
          Authorization: `Bearer ${sprite.apiSecret}`,
        },
      });

      if (!healthResponse.ok) {
        return { healthy: false, cloneReady: false, error: "Health check failed" };
      }

      const health = await healthResponse.json();

      // Check clone status
      const cloneResponse = await fetch(`${sprite.apiUrl}/clone-status`, {
        headers: {
          Authorization: `Bearer ${sprite.apiSecret}`,
        },
      });

      let cloneReady = false;
      if (cloneResponse.ok) {
        const cloneStatus = await cloneResponse.json();
        cloneReady = cloneStatus.status === "ready";
      }

      return {
        healthy: true,
        cloneReady,
        uptime: health.uptime,
      };
    } catch (error) {
      console.error("[checkHealth] Error:", error);
      return {
        healthy: false,
        cloneReady: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Apply file changes from a fileChange record to the Sprite container
export const applyFileChanges = action({
  args: {
    spriteId: v.id("flyioSprites"),
    fileChangeId: v.id("fileChanges"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

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
      const response = await fetch(`${sprite.apiUrl}/files/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sprite.apiSecret}`,
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

// Execute a bash command from a bashCommand record in the Sprite container
export const executeBashCommand = action({
  args: {
    spriteId: v.id("flyioSprites"),
    bashCommandId: v.id("bashCommands"),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    exitCode?: number;
    output?: string;
    error?: string;
  }> => {
    const sprite = await getSpriteForApi(ctx, args.spriteId);

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

      const response = await fetch(`${sprite.apiUrl}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sprite.apiSecret}`,
        },
        body: JSON.stringify({
          command: bashCommand.command,
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
