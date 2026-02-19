"use node";

import { v } from "convex/values";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Firecracker File Operations
 *
 * These actions handle file operations and command execution
 * within Firecracker VMs via the host API's exec endpoint.
 * File content is transmitted via base64 encoding through shell commands.
 */

const FIRECRACKER_HOST = "http://157.230.181.26:8080";

// Type for VM returned from queries
interface FirecrackerVmData {
  _id: Id<"firecrackerVms">;
  vmId?: string;
  status: string;
}

// Helper to get VM and validate it's ready for API calls
async function getVmForApi(
  ctx: ActionCtx,
  vmId: Id<"firecrackerVms">,
): Promise<{ hostVmId: string; status: string }> {
  const vm = (await ctx.runQuery(
    internal.firecrackerVms.getByIdInternal,
    { vmId },
  )) as FirecrackerVmData | null;

  if (!vm) {
    throw new Error("Firecracker VM not found");
  }

  if (vm.status !== "ready" && vm.status !== "active") {
    throw new Error(`Firecracker VM is not ready (status: ${vm.status})`);
  }

  if (!vm.vmId) {
    throw new Error("Firecracker VM has no host VM ID");
  }

  return {
    hostVmId: vm.vmId,
    status: vm.status,
  };
}

// Execute a command in a Firecracker VM via the host API
async function execInVm(
  hostVmId: string,
  command: string,
  timeout: number = 60000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const apiSecret = process.env.FIRECRACKER_API_SECRET;
  if (!apiSecret) {
    throw new Error("FIRECRACKER_API_SECRET not configured");
  }

  const hostUrl = process.env.FIRECRACKER_HOST_URL || FIRECRACKER_HOST;

  const response = await fetch(`${hostUrl}/api/vms/${hostVmId}/exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, timeout }),
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
}

// Apply file changes from a fileChange record to a Firecracker VM
export const applyFileChanges = action({
  args: {
    vmId: v.id("firecrackerVms"),
    fileChangeId: v.id("fileChanges"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const vm = await getVmForApi(ctx, args.vmId);

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
      // Apply all file changes in parallel using base64 encoding
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
            const result = await execInVm(vm.hostVmId, command);
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

      // Mark as applied
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

// Execute a bash command from a bashCommand record in a Firecracker VM
export const executeBashCommand = action({
  args: {
    vmId: v.id("firecrackerVms"),
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
    const vm = await getVmForApi(ctx, args.vmId);

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

      // Execute in the VM's /app directory
      const command = `cd /app && ${bashCommand.command}`;
      const result = await execInVm(vm.hostVmId, command, 120000);

      const output = (result.stdout || "") + (result.stderr || "");

      // Mark as completed
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
