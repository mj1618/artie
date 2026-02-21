import {
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const DOCKER_HOST = process.env.DOCKER_HOST_URL!;

// ====================
// QUERIES
// ====================

export const getCheckpoint = internalQuery({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dockerCheckpoints")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .filter((q) => q.eq(q.field("status"), "ready"))
      .first();
  },
});

// ====================
// MUTATIONS
// ====================

export const recordCheckpoint = internalMutation({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    checkpointName: v.string(),
    imageTag: v.optional(v.string()),
    sourceContainerId: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("dockerCheckpoints")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .first();

    if (existing) {
      await ctx.db.patch("dockerCheckpoints", existing._id, {
        checkpointName: args.checkpointName,
        imageTag: args.imageTag,
        sourceContainerId: args.sourceContainerId,
        status: args.status,
        errorMessage: args.errorMessage,
        createdAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("dockerCheckpoints", {
      repoId: args.repoId,
      branch: args.branch,
      checkpointName: args.checkpointName,
      imageTag: args.imageTag,
      sourceContainerId: args.sourceContainerId,
      status: args.status,
      errorMessage: args.errorMessage,
      createdAt: now,
      useCount: 0,
    });
  },
});

export const recordCheckpointUsage = internalMutation({
  args: { checkpointId: v.id("dockerCheckpoints") },
  handler: async (ctx, args) => {
    const checkpoint = await ctx.db.get("dockerCheckpoints", args.checkpointId);
    if (!checkpoint) return;

    await ctx.db.patch("dockerCheckpoints", args.checkpointId, {
      lastUsedAt: Date.now(),
      useCount: checkpoint.useCount + 1,
    });
  },
});

// ====================
// ACTIONS
// ====================

export const createCheckpoint = internalAction({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    hostContainerId: v.string(),
    owner: v.string(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) return;

    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;
    const cpName = `cp-${args.owner}-${args.repo}-${args.branch}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
    const callbackUrl = process.env.CONVEX_SITE_URL + "/docker-checkpoint-status";

    try {
      const response = await fetch(
        `${hostUrl}/api/containers/${args.hostContainerId}/checkpoint`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            checkpointName: cpName,
            callbackUrl,
            callbackSecret: apiSecret,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`[createCheckpoint] Failed: ${error}`);
        await ctx.runMutation(internal.dockerCheckpoints.recordCheckpoint, {
          repoId: args.repoId,
          branch: args.branch,
          checkpointName: cpName,
          sourceContainerId: args.hostContainerId,
          status: "failed",
          errorMessage: error,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[createCheckpoint] Error: ${message}`);
    }
  },
});

export const restoreFromCheckpoint = internalAction({
  args: {
    checkpointName: v.string(),
    containerName: v.string(),
    volumeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) {
      return { success: false as const, error: "DOCKER_API_SECRET not configured" };
    }

    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

    try {
      const response = await fetch(
        `${hostUrl}/api/checkpoints/${args.checkpointName}/restore`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            containerName: args.containerName,
            ports: [3000],
            volumeName: args.volumeName,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false as const, error };
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        hostPort: number;
        restoredFrom: string;
      };

      return { success: true as const, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false as const, error: message };
    }
  },
});
