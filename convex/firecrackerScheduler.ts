import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { TIMEOUTS } from "./firecrackerVms";

// ====================
// SCHEDULED JOBS
// ====================

// Process "requested" VMs - pick up and start creating
// Should be scheduled to run every 5 seconds
export const processRequested = internalMutation({
  handler: async (ctx) => {
    const requestedVms = await ctx.runQuery(
      internal.firecrackerVms.getByStatus,
      {
        status: "requested",
        limit: 5,
      }
    );

    for (const vm of requestedVms) {
      // Transition to "creating"
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: vm._id,
        status: "creating",
        reason: "scheduler_picked_up",
      });

      // Schedule the create action
      await ctx.scheduler.runAfter(0, internal.firecrackerVms.createVm, {
        vmId: vm._id,
      });

      console.log(
        `[firecracker:processRequested] Scheduled creation for VM ${vm._id}`
      );
    }

    if (requestedVms.length > 0) {
      console.log(
        `[firecracker:processRequested] Processed ${requestedVms.length} requested VMs`
      );
    }
  },
});

// Check heartbeats - demote active to ready, or stop inactive VMs
// Should be scheduled to run every 30 seconds
export const checkHeartbeats = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Find "active" VMs with old heartbeats
    const activeVms = await ctx.runQuery(
      internal.firecrackerVms.getByStatus,
      {
        status: "active",
      }
    );

    for (const vm of activeVms) {
      if (!vm.lastHeartbeatAt) continue;

      const timeSinceHeartbeat = now - vm.lastHeartbeatAt;

      if (timeSinceHeartbeat > TIMEOUTS.heartbeat_stop) {
        // No heartbeat for too long, stop the VM
        await ctx.runMutation(internal.firecrackerVms.updateStatus, {
          vmId: vm._id,
          status: "stopping",
          reason: "no_heartbeat_timeout",
        });
        console.log(
          `[firecracker:checkHeartbeats] Stopping VM ${vm._id} - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`
        );
      } else if (timeSinceHeartbeat > TIMEOUTS.heartbeat_warning) {
        // Heartbeat is late, demote to "ready"
        await ctx.runMutation(internal.firecrackerVms.updateStatus, {
          vmId: vm._id,
          status: "ready",
          reason: "heartbeat_late",
        });
        console.log(
          `[firecracker:checkHeartbeats] Demoted VM ${vm._id} to ready - heartbeat late by ${Math.round(timeSinceHeartbeat / 1000)}s`
        );
      }
    }

    // Also check "ready" VMs that have been ready too long without heartbeat
    const readyVms = await ctx.runQuery(
      internal.firecrackerVms.getByStatus,
      {
        status: "ready",
      }
    );

    for (const vm of readyVms) {
      const heartbeatTime = vm.lastHeartbeatAt || vm.statusChangedAt;
      const timeSinceActivity = now - heartbeatTime;

      if (timeSinceActivity > TIMEOUTS.heartbeat_stop) {
        await ctx.runMutation(internal.firecrackerVms.updateStatus, {
          vmId: vm._id,
          status: "stopping",
          reason: "no_heartbeat_ready_timeout",
        });
        console.log(
          `[firecracker:checkHeartbeats] Stopping ready VM ${vm._id} - no activity for ${Math.round(timeSinceActivity / 1000)}s`
        );
      }
    }
  },
});

// Check for stuck VMs in transitional states
// Should be scheduled to run every 15 seconds
export const checkTimeouts = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Check each transitional state for timeouts
    // Firecracker has "starting" state (unlike droplets) but no "provisioning"
    const statesWithTimeouts: Array<{
      status:
        | "creating"
        | "booting"
        | "cloning"
        | "installing"
        | "starting";
      timeout: number;
    }> = [
      { status: "creating", timeout: TIMEOUTS.creating },
      { status: "booting", timeout: TIMEOUTS.booting },
      { status: "cloning", timeout: TIMEOUTS.cloning },
      { status: "installing", timeout: TIMEOUTS.installing },
      { status: "starting", timeout: TIMEOUTS.starting },
    ];

    for (const { status, timeout } of statesWithTimeouts) {
      const timedOutVms = await ctx.runQuery(
        internal.firecrackerVms.getTimedOutVms,
        {
          status,
          olderThan: now - timeout,
        }
      );

      for (const vm of timedOutVms) {
        await ctx.runMutation(internal.firecrackerVms.updateStatus, {
          vmId: vm._id,
          status: "unhealthy",
          updates: {
            errorMessage: `Timed out in ${status} state after ${Math.round(timeout / 60000)} minutes`,
          },
          reason: `${status}_timeout`,
        });
        console.log(
          `[firecracker:checkTimeouts] Marked VM ${vm._id} as unhealthy - ${status} timeout`
        );
      }
    }
  },
});

// Process "stopping" VMs - start destruction
// Should be scheduled to run every 10 seconds
export const processStopping = internalMutation({
  handler: async (ctx) => {
    const stoppingVms = await ctx.runQuery(
      internal.firecrackerVms.getByStatus,
      {
        status: "stopping",
        limit: 10,
      }
    );

    for (const vm of stoppingVms) {
      // Transition to "destroying"
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: vm._id,
        status: "destroying",
        reason: "destruction_started",
      });

      // Schedule the destroy action
      await ctx.scheduler.runAfter(0, internal.firecrackerVms.destroyVm, {
        vmId: vm._id,
      });

      console.log(
        `[firecracker:processStopping] Scheduled destruction for VM ${vm._id}`
      );
    }

    if (stoppingVms.length > 0) {
      console.log(
        `[firecracker:processStopping] Processed ${stoppingVms.length} stopping VMs`
      );
    }
  },
});

// Process "unhealthy" VMs - clean them up
// Should be scheduled to run every 30 seconds
export const processUnhealthy = internalMutation({
  handler: async (ctx) => {
    const unhealthyVms = await ctx.runQuery(
      internal.firecrackerVms.getByStatus,
      {
        status: "unhealthy",
        limit: 10,
      }
    );

    for (const vm of unhealthyVms) {
      // Transition to "destroying"
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: vm._id,
        status: "destroying",
        reason: "unhealthy_cleanup",
      });

      // Schedule the destroy action
      await ctx.scheduler.runAfter(0, internal.firecrackerVms.destroyVm, {
        vmId: vm._id,
      });

      console.log(
        `[firecracker:processUnhealthy] Scheduled destruction for unhealthy VM ${vm._id}`
      );
    }

    if (unhealthyVms.length > 0) {
      console.log(
        `[firecracker:processUnhealthy] Processed ${unhealthyVms.length} unhealthy VMs`
      );
    }
  },
});

// Clean up old destroyed records
// Should be scheduled to run every hour
export const cleanupOldRecords = internalMutation({
  handler: async (ctx) => {
    // Delete records destroyed more than 24 hours ago
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const result = await ctx.runMutation(
      internal.firecrackerVms.deleteOldDestroyed,
      {
        olderThan: cutoff,
      }
    );

    if (result.deleted > 0) {
      console.log(
        `[firecracker:cleanupOldRecords] Deleted ${result.deleted} old destroyed records`
      );
    }
  },
});
