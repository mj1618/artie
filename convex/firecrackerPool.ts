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
  targetSize: 3,           // Target number of ready VMs in pool
  minSize: 1,              // Minimum ready VMs before urgent replenishment
  maxCreating: 2,          // Max concurrent VM creations
  vmMemory: 2048,          // MB - Next.js apps need ~800MB+ for Turbopack compilation
  vmVcpus: 2,
  vmPorts: [3000],
};

const FIRECRACKER_HOST = "http://157.230.181.26:8080";

// Generate a unique pool VM name
function generatePoolVmName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `pool-${timestamp}-${random}`;
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
        .query("firecrackerVmPool")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect(),
      ctx.db
        .query("firecrackerVmPool")
        .withIndex("by_status", (q) => q.eq("status", "creating"))
        .collect(),
      ctx.db
        .query("firecrackerVmPool")
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

// Get a ready VM from the pool (oldest first for fairness)
export const getReadyVm = internalQuery({
  handler: async (ctx): Promise<Doc<"firecrackerVmPool"> | null> => {
    return await ctx.db
      .query("firecrackerVmPool")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .order("asc") // Oldest first
      .first();
  },
});

// Get pool VM by ID
export const getById = internalQuery({
  args: { poolVmId: v.id("firecrackerVmPool") },
  handler: async (ctx, args) => {
    return await ctx.db.get("firecrackerVmPool", args.poolVmId);
  },
});

// Get creating VMs count
export const getCreatingCount = internalQuery({
  handler: async (ctx) => {
    const creating = await ctx.db
      .query("firecrackerVmPool")
      .withIndex("by_status", (q) => q.eq("status", "creating"))
      .collect();
    return creating.length;
  },
});

// ====================
// MUTATIONS
// ====================

// Create a new pool VM record (start of creation process)
export const createPoolVmRecord = internalMutation({
  handler: async (ctx) => {
    const vmName = generatePoolVmName();
    const now = Date.now();

    const poolVmId = await ctx.db.insert("firecrackerVmPool", {
      vmId: "", // Will be set when host responds
      vmName,
      vmIp: "",
      hostPort: 0,
      status: "creating",
      createdAt: now,
    });

    console.log(`[firecrackerPool] Created pool VM record: ${vmName}`);
    return { poolVmId, vmName };
  },
});

// Update pool VM with host data after creation
export const updatePoolVmReady = internalMutation({
  args: {
    poolVmId: v.id("firecrackerVmPool"),
    vmId: v.string(),
    vmIp: v.string(),
    hostPort: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("firecrackerVmPool", args.poolVmId, {
      vmId: args.vmId,
      vmIp: args.vmIp,
      hostPort: args.hostPort,
      status: "ready",
      readyAt: now,
    });
    console.log(`[firecrackerPool] Pool VM ${args.poolVmId} is now ready`);
  },
});

// Mark pool VM as failed
export const markPoolVmFailed = internalMutation({
  args: {
    poolVmId: v.id("firecrackerVmPool"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("firecrackerVmPool", args.poolVmId, {
      status: "failed",
      errorMessage: args.errorMessage,
    });
    console.log(`[firecrackerPool] Pool VM ${args.poolVmId} failed: ${args.errorMessage}`);
  },
});

// Assign a pool VM to a session (returns the pool VM data)
export const assignPoolVm = internalMutation({
  args: {
    poolVmId: v.id("firecrackerVmPool"),
  },
  handler: async (ctx, args) => {
    const poolVm = await ctx.db.get("firecrackerVmPool", args.poolVmId);
    if (!poolVm || poolVm.status !== "ready") {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("firecrackerVmPool", args.poolVmId, {
      status: "assigned",
      assignedAt: now,
    });

    console.log(`[firecrackerPool] Assigned pool VM ${poolVm.vmName}`);
    return poolVm;
  },
});

// Delete pool VM record (after assignment or cleanup)
export const deletePoolVm = internalMutation({
  args: { poolVmId: v.id("firecrackerVmPool") },
  handler: async (ctx, args) => {
    await ctx.db.delete("firecrackerVmPool", args.poolVmId);
  },
});

// Mark pool VM as destroying
export const markDestroying = internalMutation({
  args: { poolVmId: v.id("firecrackerVmPool") },
  handler: async (ctx, args) => {
    await ctx.db.patch("firecrackerVmPool", args.poolVmId, {
      status: "destroying",
    });
  },
});

// ====================
// ACTIONS
// ====================

// Create a VM on the Firecracker host for the pool
export const createPoolVm = internalAction({
  args: { poolVmId: v.id("firecrackerVmPool"), vmName: v.string() },
  handler: async (ctx, args) => {
    console.log(`[firecrackerPool:createPoolVm] Starting for ${args.vmName}`);

    const apiSecret = process.env.FIRECRACKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.firecrackerPool.markPoolVmFailed, {
        poolVmId: args.poolVmId,
        errorMessage: "FIRECRACKER_API_SECRET not configured",
      });
      return;
    }

    const hostUrl = process.env.FIRECRACKER_HOST_URL || FIRECRACKER_HOST;

    try {
      const response = await fetch(`${hostUrl}/api/vms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: args.vmName,
          memory: POOL_CONFIG.vmMemory,
          vcpus: POOL_CONFIG.vmVcpus,
          ports: POOL_CONFIG.vmPorts,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[firecrackerPool:createPoolVm] Host API error: ${error}`);
        await ctx.runMutation(internal.firecrackerPool.markPoolVmFailed, {
          poolVmId: args.poolVmId,
          errorMessage: `Failed to create pool VM: ${error}`,
        });
        return;
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        status: string;
        ip: string;
        ports?: Array<{ guest: number; host: number }>;
      };

      const hostPort = data.ports?.[0]?.host ?? 0;

      // Wait a moment for the VM to fully boot
      // Firecracker VMs boot in <125ms but we give it 500ms to be safe
      await new Promise((resolve) => setTimeout(resolve, 500));

      await ctx.runMutation(internal.firecrackerPool.updatePoolVmReady, {
        poolVmId: args.poolVmId,
        vmId: data.id,
        vmIp: data.ip,
        hostPort,
      });

      console.log(`[firecrackerPool:createPoolVm] Pool VM ${args.vmName} ready: ${data.ip}:${hostPort}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[firecrackerPool:createPoolVm] Error: ${message}`);
      await ctx.runMutation(internal.firecrackerPool.markPoolVmFailed, {
        poolVmId: args.poolVmId,
        errorMessage: `Create pool VM error: ${message}`,
      });
    }
  },
});

// Destroy a pool VM on the host
export const destroyPoolVm = internalAction({
  args: { poolVmId: v.id("firecrackerVmPool") },
  handler: async (ctx, args) => {
    console.log(`[firecrackerPool:destroyPoolVm] Starting for ${args.poolVmId}`);

    const poolVm = await ctx.runQuery(internal.firecrackerPool.getById, {
      poolVmId: args.poolVmId,
    });

    if (!poolVm) {
      console.log(`[firecrackerPool:destroyPoolVm] Pool VM not found`);
      return;
    }

    // Mark as destroying
    await ctx.runMutation(internal.firecrackerPool.markDestroying, {
      poolVmId: args.poolVmId,
    });

    if (poolVm.vmId) {
      const apiSecret = process.env.FIRECRACKER_API_SECRET;
      const hostUrl = process.env.FIRECRACKER_HOST_URL || FIRECRACKER_HOST;

      try {
        const response = await fetch(`${hostUrl}/api/vms/${poolVm.vmId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.error(`[firecrackerPool:destroyPoolVm] Failed: ${await response.text()}`);
        }
      } catch (err) {
        console.error(`[firecrackerPool:destroyPoolVm] Error: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    // Delete the record
    await ctx.runMutation(internal.firecrackerPool.deletePoolVm, {
      poolVmId: args.poolVmId,
    });

    console.log(`[firecrackerPool:destroyPoolVm] Pool VM ${poolVm.vmName} destroyed`);
  },
});

// ====================
// SCHEDULER FUNCTIONS
// ====================

// Replenish the pool if needed
export const replenishPool = internalMutation({
  handler: async (ctx): Promise<{ created: number; stats: PoolStats }> => {
    // Get pool stats directly instead of via runQuery to avoid circular reference
    const [readyVms, creatingVms, failedVms] = await Promise.all([
      ctx.db
        .query("firecrackerVmPool")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect(),
      ctx.db
        .query("firecrackerVmPool")
        .withIndex("by_status", (q) => q.eq("status", "creating"))
        .collect(),
      ctx.db
        .query("firecrackerVmPool")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .collect(),
    ]);

    const stats: PoolStats = {
      ready: readyVms.length,
      creating: creatingVms.length,
      failed: failedVms.length,
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

    // Create new pool VMs
    for (let i = 0; i < canCreate; i++) {
      const vmName = generatePoolVmName();
      const now = Date.now();

      const poolVmId = await ctx.db.insert("firecrackerVmPool", {
        vmId: "",
        vmName,
        vmIp: "",
        hostPort: 0,
        status: "creating",
        createdAt: now,
      });

      await ctx.scheduler.runAfter(0, internal.firecrackerPool.createPoolVm, {
        poolVmId,
        vmName,
      });
    }

    console.log(`[firecrackerPool:replenishPool] Scheduled ${canCreate} new pool VMs (ready: ${stats.ready}, creating: ${stats.creating})`);

    return { created: canCreate, stats };
  },
});

// Clean up failed pool VMs
export const cleanupFailedPoolVms = internalMutation({
  handler: async (ctx) => {
    const failedVms = await ctx.db
      .query("firecrackerVmPool")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();

    for (const vm of failedVms) {
      // Schedule destruction (which also deletes the record)
      await ctx.scheduler.runAfter(0, internal.firecrackerPool.destroyPoolVm, {
        poolVmId: vm._id,
      });
    }

    if (failedVms.length > 0) {
      console.log(`[firecrackerPool:cleanupFailed] Scheduled cleanup of ${failedVms.length} failed pool VMs`);
    }

    return { cleaned: failedVms.length };
  },
});

// Clean up assigned pool VMs (records that are stuck in assigned state)
export const cleanupAssignedPoolVms = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    const assignedVms = await ctx.db
      .query("firecrackerVmPool")
      .withIndex("by_status", (q) => q.eq("status", "assigned"))
      .collect();

    let cleaned = 0;
    for (const vm of assignedVms) {
      if (vm.assignedAt && now - vm.assignedAt > staleThreshold) {
        // Delete stale assigned records (the VM is now managed by firecrackerVms)
        await ctx.db.delete("firecrackerVmPool", vm._id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[firecrackerPool:cleanupAssigned] Deleted ${cleaned} stale assigned records`);
    }

    return { cleaned };
  },
});
