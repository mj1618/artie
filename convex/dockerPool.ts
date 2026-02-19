import {
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

// Pool configuration
export const POOL_CONFIG = {
  targetSize: 3,
  minSize: 1,
  maxCreating: 2,
  containerPorts: [3000],
};

const DOCKER_HOST = process.env.DOCKER_HOST_URL!;

// Generate a unique pool container name
function generatePoolContainerName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `pool-docker-${timestamp}-${random}`;
}

// ====================
// QUERIES
// ====================

// Pool stats type
type PoolStats = {
  ready: number;
  creating: number;
  failed: number;
  targetSize: number;
  minSize: number;
};

// Get pool statistics
export const getPoolStats = internalQuery({
  handler: async (ctx): Promise<PoolStats> => {
    const [ready, creating, failed] = await Promise.all([
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect(),
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "creating"))
        .collect(),
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .collect(),
    ]);

    return {
      ready: ready.length,
      creating: creating.length,
      failed: failed.length,
      targetSize: POOL_CONFIG.targetSize,
      minSize: POOL_CONFIG.minSize,
    };
  },
});

// Get a ready container from the pool (oldest first for fairness)
export const getReadyContainer = internalQuery({
  handler: async (ctx): Promise<Doc<"dockerContainerPool"> | null> => {
    return await ctx.db
      .query("dockerContainerPool")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .order("asc")
      .first();
  },
});

// Get pool container by ID
export const getById = internalQuery({
  args: { poolContainerId: v.id("dockerContainerPool") },
  handler: async (ctx, args) => {
    return await ctx.db.get("dockerContainerPool", args.poolContainerId);
  },
});

// Get creating containers count
export const getCreatingCount = internalQuery({
  handler: async (ctx) => {
    const creating = await ctx.db
      .query("dockerContainerPool")
      .withIndex("by_status", (q) => q.eq("status", "creating"))
      .collect();
    return creating.length;
  },
});

// ====================
// MUTATIONS
// ====================

// Create a new pool container record (start of creation process)
export const createPoolContainerRecord = internalMutation({
  handler: async (ctx) => {
    const containerName = generatePoolContainerName();
    const now = Date.now();

    const poolContainerId = await ctx.db.insert("dockerContainerPool", {
      containerId: "",
      containerName,
      hostPort: 0,
      status: "creating",
      createdAt: now,
    });

    console.log(`[dockerPool] Created pool container record: ${containerName}`);
    return { poolContainerId, containerName };
  },
});

// Update pool container with host data after creation
export const updatePoolContainerReady = internalMutation({
  args: {
    poolContainerId: v.id("dockerContainerPool"),
    containerId: v.string(),
    hostPort: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("dockerContainerPool", args.poolContainerId, {
      containerId: args.containerId,
      hostPort: args.hostPort,
      status: "ready",
      readyAt: now,
    });
    console.log(`[dockerPool] Pool container ${args.poolContainerId} is now ready`);
  },
});

// Mark pool container as failed
export const markPoolContainerFailed = internalMutation({
  args: {
    poolContainerId: v.id("dockerContainerPool"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("dockerContainerPool", args.poolContainerId, {
      status: "failed",
      errorMessage: args.errorMessage,
    });
    console.log(`[dockerPool] Pool container ${args.poolContainerId} failed: ${args.errorMessage}`);
  },
});

// Assign a pool container to a session (returns the pool container data)
export const assignPoolContainer = internalMutation({
  args: {
    poolContainerId: v.id("dockerContainerPool"),
  },
  handler: async (ctx, args) => {
    const poolContainer = await ctx.db.get("dockerContainerPool", args.poolContainerId);
    if (!poolContainer || poolContainer.status !== "ready") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("dockerContainerPool", args.poolContainerId, {
      status: "assigned",
      assignedAt: now,
    });

    console.log(`[dockerPool] Assigned pool container ${poolContainer.containerName}`);
    return poolContainer;
  },
});

// Delete pool container record (after assignment or cleanup)
export const deletePoolContainer = internalMutation({
  args: { poolContainerId: v.id("dockerContainerPool") },
  handler: async (ctx, args) => {
    await ctx.db.delete("dockerContainerPool", args.poolContainerId);
  },
});

// Mark pool container as destroying
export const markDestroying = internalMutation({
  args: { poolContainerId: v.id("dockerContainerPool") },
  handler: async (ctx, args) => {
    await ctx.db.patch("dockerContainerPool", args.poolContainerId, {
      status: "destroying",
    });
  },
});

// ====================
// ACTIONS
// ====================

// Create a container on the Docker host for the pool
export const createPoolContainer = internalAction({
  args: { poolContainerId: v.id("dockerContainerPool"), containerName: v.string() },
  handler: async (ctx, args) => {
    console.log(`[dockerPool:createPoolContainer] Starting for ${args.containerName}`);

    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.dockerPool.markPoolContainerFailed, {
        poolContainerId: args.poolContainerId,
        errorMessage: "DOCKER_API_SECRET not configured",
      });
      return;
    }

    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

    try {
      let response = await fetch(`${hostUrl}/api/containers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: args.containerName,
          image: "node:24-slim-git",
          ports: POOL_CONFIG.containerPorts,
          pool: true,
        }),
      });

      if (response.status === 409) {
        const conflictText = await response.text();
        console.warn(`[dockerPool:createPoolContainer] 409 conflict for ${args.containerName}, removing stale container and retrying`);

        const staleIdMatch = conflictText.match(/by container "([a-f0-9]+)"/);
        const staleId = staleIdMatch?.[1];
        if (staleId) {
          try {
            await fetch(`${hostUrl}/api/containers/${staleId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiSecret}` },
            });
          } catch (deleteErr) {
            console.warn(`[dockerPool:createPoolContainer] Failed to remove stale container: ${deleteErr instanceof Error ? deleteErr.message : "unknown"}`);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        response = await fetch(`${hostUrl}/api/containers`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: args.containerName,
            image: "node:24-slim-git",
            ports: POOL_CONFIG.containerPorts,
            pool: true,
          }),
        });
      }

      if (!response.ok) {
        const error = await response.text();
        console.error(`[dockerPool:createPoolContainer] Host API error: ${error}`);
        await ctx.runMutation(internal.dockerPool.markPoolContainerFailed, {
          poolContainerId: args.poolContainerId,
          errorMessage: `Failed to create pool container: ${error}`,
        });
        return;
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        hostPort: number;
      };

      // Wait a moment for the container to fully start
      await new Promise((resolve) => setTimeout(resolve, 500));

      await ctx.runMutation(internal.dockerPool.updatePoolContainerReady, {
        poolContainerId: args.poolContainerId,
        containerId: data.id,
        hostPort: data.hostPort,
      });

      console.log(`[dockerPool:createPoolContainer] Pool container ${args.containerName} ready: port ${data.hostPort}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[dockerPool:createPoolContainer] Error: ${message}`);
      await ctx.runMutation(internal.dockerPool.markPoolContainerFailed, {
        poolContainerId: args.poolContainerId,
        errorMessage: `Create pool container error: ${message}`,
      });
    }
  },
});

// Destroy a pool container on the host
export const destroyPoolContainer = internalAction({
  args: { poolContainerId: v.id("dockerContainerPool") },
  handler: async (ctx, args) => {
    console.log(`[dockerPool:destroyPoolContainer] Starting for ${args.poolContainerId}`);

    const poolContainer = await ctx.runQuery(internal.dockerPool.getById, {
      poolContainerId: args.poolContainerId,
    });

    if (!poolContainer) {
      console.log(`[dockerPool:destroyPoolContainer] Pool container not found`);
      return;
    }

    await ctx.runMutation(internal.dockerPool.markDestroying, {
      poolContainerId: args.poolContainerId,
    });

    if (poolContainer.containerId) {
      const apiSecret = process.env.DOCKER_API_SECRET;
      const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

      try {
        const response = await fetch(`${hostUrl}/api/containers/${poolContainer.containerId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.error(`[dockerPool:destroyPoolContainer] Failed: ${await response.text()}`);
        }
      } catch (err) {
        console.error(`[dockerPool:destroyPoolContainer] Error: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    await ctx.runMutation(internal.dockerPool.deletePoolContainer, {
      poolContainerId: args.poolContainerId,
    });

    console.log(`[dockerPool:destroyPoolContainer] Pool container ${poolContainer.containerName} destroyed`);
  },
});

// ====================
// SCHEDULER FUNCTIONS
// ====================

// Replenish the pool if needed
export const replenishPool = internalMutation({
  handler: async (ctx): Promise<{ created: number; stats: PoolStats }> => {
    const [readyContainers, creatingContainers, failedContainers] = await Promise.all([
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect(),
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "creating"))
        .collect(),
      ctx.db
        .query("dockerContainerPool")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .collect(),
    ]);

    const stats: PoolStats = {
      ready: readyContainers.length,
      creating: creatingContainers.length,
      failed: failedContainers.length,
      targetSize: POOL_CONFIG.targetSize,
      minSize: POOL_CONFIG.minSize,
    };

    const needed = POOL_CONFIG.targetSize - stats.ready - stats.creating;
    const canCreate = Math.min(
      needed,
      POOL_CONFIG.maxCreating - stats.creating
    );

    if (canCreate <= 0) {
      return { created: 0, stats };
    }

    for (let i = 0; i < canCreate; i++) {
      const containerName = generatePoolContainerName();
      const now = Date.now();

      const poolContainerId = await ctx.db.insert("dockerContainerPool", {
        containerId: "",
        containerName,
        hostPort: 0,
        status: "creating",
        createdAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.dockerPool.createPoolContainer, {
        poolContainerId,
        containerName,
      });
    }

    console.log(`[dockerPool:replenishPool] Scheduled ${canCreate} new pool containers (ready: ${stats.ready}, creating: ${stats.creating})`);

    return { created: canCreate, stats };
  },
});

// Clean up failed pool containers
export const cleanupFailedPoolContainers = internalMutation({
  handler: async (ctx) => {
    const failedContainers = await ctx.db
      .query("dockerContainerPool")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();

    for (const container of failedContainers) {
      await ctx.scheduler.runAfter(0, internal.dockerPool.destroyPoolContainer, {
        poolContainerId: container._id,
      });
    }

    if (failedContainers.length > 0) {
      console.log(`[dockerPool:cleanupFailed] Scheduled cleanup of ${failedContainers.length} failed pool containers`);
    }

    return { cleaned: failedContainers.length };
  },
});

// Force clear all pool records (for debugging)
export const forceClearAll = internalMutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("dockerContainerPool").collect();
    for (const record of all) {
      await ctx.db.delete("dockerContainerPool", record._id);
    }
    return { deleted: all.length };
  },
});

// Clean up assigned pool containers (records that are stuck in assigned state)
export const cleanupAssignedPoolContainers = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    const assignedContainers = await ctx.db
      .query("dockerContainerPool")
      .withIndex("by_status", (q) => q.eq("status", "assigned"))
      .collect();

    let cleaned = 0;
    for (const container of assignedContainers) {
      if (container.assignedAt && now - container.assignedAt > staleThreshold) {
        await ctx.db.delete("dockerContainerPool", container._id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[dockerPool:cleanupAssigned] Deleted ${cleaned} stale assigned records`);
    }

    return { cleaned };
  },
});
