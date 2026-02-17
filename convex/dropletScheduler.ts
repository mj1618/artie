import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { TIMEOUTS } from "./droplets";

// ====================
// SCHEDULED JOBS
// ====================

// Process "requested" droplets - pick up and start creating
// Should be scheduled to run every 10 seconds
export const processRequested = internalMutation({
  handler: async (ctx) => {
    const requestedDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "requested",
      limit: 5, // Process up to 5 at a time
    });

    for (const droplet of requestedDroplets) {
      // Transition to "creating"
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: droplet._id,
        status: "creating",
        reason: "scheduler_picked_up",
      });

      // Schedule the create action
      await ctx.scheduler.runAfter(0, internal.droplets.createDroplet, {
        dropletId: droplet._id,
      });

      console.log(`[processRequested] Scheduled creation for droplet ${droplet._id}`);
    }

    if (requestedDroplets.length > 0) {
      console.log(`[processRequested] Processed ${requestedDroplets.length} requested droplets`);
    }
  },
});

// Process "create_failed" droplets - retry with exponential backoff
// Should be scheduled to run every 10 seconds
export const processCreateFailed = internalMutation({
  handler: async (ctx) => {
    const failedDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "create_failed",
      limit: 5,
    });

    for (const droplet of failedDroplets) {
      // Check if we should retry
      const shouldRetry = await ctx.runQuery(internal.droplets.shouldRetryCreation, {
        dropletId: droplet._id,
      });

      if (shouldRetry) {
        // Transition to "creating"
        await ctx.runMutation(internal.droplets.updateStatus, {
          dropletId: droplet._id,
          status: "creating",
          reason: `retry_attempt_${droplet.retryCount + 1}`,
        });

        // Schedule the create action
        await ctx.scheduler.runAfter(0, internal.droplets.createDroplet, {
          dropletId: droplet._id,
        });

        console.log(
          `[processCreateFailed] Retrying creation for droplet ${droplet._id} (attempt ${droplet.retryCount + 1})`
        );
      }
    }
  },
});

// Check heartbeats - demote active to ready, or stop inactive droplets
// Should be scheduled to run every 30 seconds
export const checkHeartbeats = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Find "active" droplets with old heartbeats
    const activeDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "active",
    });

    for (const droplet of activeDroplets) {
      if (!droplet.lastHeartbeatAt) continue;

      const timeSinceHeartbeat = now - droplet.lastHeartbeatAt;

      if (timeSinceHeartbeat > TIMEOUTS.heartbeat_stop) {
        // No heartbeat for too long, stop the droplet
        await ctx.runMutation(internal.droplets.updateStatus, {
          dropletId: droplet._id,
          status: "stopping",
          reason: "no_heartbeat_timeout",
        });
        console.log(`[checkHeartbeats] Stopping droplet ${droplet._id} - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`);
      } else if (timeSinceHeartbeat > TIMEOUTS.heartbeat_warning) {
        // Heartbeat is late, demote to "ready"
        await ctx.runMutation(internal.droplets.updateStatus, {
          dropletId: droplet._id,
          status: "ready",
          reason: "heartbeat_late",
        });
        console.log(`[checkHeartbeats] Demoted droplet ${droplet._id} to ready - heartbeat late by ${Math.round(timeSinceHeartbeat / 1000)}s`);
      }
    }

    // Also check "ready" droplets that have been ready too long without heartbeat
    const readyDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "ready",
    });

    for (const droplet of readyDroplets) {
      const heartbeatTime = droplet.lastHeartbeatAt || droplet.statusChangedAt;
      const timeSinceActivity = now - heartbeatTime;

      if (timeSinceActivity > TIMEOUTS.heartbeat_stop) {
        await ctx.runMutation(internal.droplets.updateStatus, {
          dropletId: droplet._id,
          status: "stopping",
          reason: "no_heartbeat_ready_timeout",
        });
        console.log(`[checkHeartbeats] Stopping ready droplet ${droplet._id} - no activity for ${Math.round(timeSinceActivity / 1000)}s`);
      }
    }
  },
});

// Check for stuck droplets in transitional states
// Should be scheduled to run every 30 seconds
export const checkTimeouts = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Check each transitional state for timeouts
    const statesWithTimeouts: Array<{
      status: "creating" | "provisioning" | "booting" | "cloning" | "installing";
      timeout: number;
    }> = [
        { status: "creating", timeout: TIMEOUTS.creating },
        { status: "provisioning", timeout: TIMEOUTS.provisioning },
        { status: "booting", timeout: TIMEOUTS.booting },
        { status: "cloning", timeout: TIMEOUTS.cloning },
        { status: "installing", timeout: TIMEOUTS.installing },
      ];

    for (const { status, timeout } of statesWithTimeouts) {
      const timedOutDroplets = await ctx.runQuery(internal.droplets.getTimedOutDroplets, {
        status,
        olderThan: now - timeout,
      });

      for (const droplet of timedOutDroplets) {
        await ctx.runMutation(internal.droplets.updateStatus, {
          dropletId: droplet._id,
          status: "unhealthy",
          updates: {
            errorMessage: `Timed out in ${status} state after ${Math.round(timeout / 60000)} minutes`,
          },
          reason: `${status}_timeout`,
        });
        console.log(`[checkTimeouts] Marked droplet ${droplet._id} as unhealthy - ${status} timeout`);
      }
    }
  },
});

// Process "stopping" droplets - start destruction
// Should be scheduled to run every 30 seconds
export const processStopping = internalMutation({
  handler: async (ctx) => {
    const stoppingDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "stopping",
      limit: 10,
    });

    for (const droplet of stoppingDroplets) {
      // Transition to "destroying"
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: droplet._id,
        status: "destroying",
        reason: "destruction_started",
      });

      // Schedule the destroy action
      await ctx.scheduler.runAfter(0, internal.droplets.destroyDroplet, {
        dropletId: droplet._id,
      });

      console.log(`[processStopping] Scheduled destruction for droplet ${droplet._id}`);
    }

    if (stoppingDroplets.length > 0) {
      console.log(`[processStopping] Processed ${stoppingDroplets.length} stopping droplets`);
    }
  },
});

// Process "unhealthy" droplets - clean them up
// Should be scheduled to run every 30 seconds
export const processUnhealthy = internalMutation({
  handler: async (ctx) => {
    const unhealthyDroplets = await ctx.runQuery(internal.droplets.getByStatus, {
      status: "unhealthy",
      limit: 10,
    });

    for (const droplet of unhealthyDroplets) {
      // Transition to "destroying"
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: droplet._id,
        status: "destroying",
        reason: "unhealthy_cleanup",
      });

      // Schedule the destroy action
      await ctx.scheduler.runAfter(0, internal.droplets.destroyDroplet, {
        dropletId: droplet._id,
      });

      console.log(`[processUnhealthy] Scheduled destruction for unhealthy droplet ${droplet._id}`);
    }

    if (unhealthyDroplets.length > 0) {
      console.log(`[processUnhealthy] Processed ${unhealthyDroplets.length} unhealthy droplets`);
    }
  },
});

// Reconcile DB state with DigitalOcean
// Should be scheduled to run every 60 seconds
export const reconcile = internalAction({
  handler: async (ctx) => {
    console.log("[reconcile] Starting reconciliation...");

    // Get all droplets from DigitalOcean with our tag
    const doDroplets = await ctx.runAction(internal.droplets.listDoDroplets, {});
    const doDropletIds = new Set(doDroplets.map((d) => d.id));
    const doDropletByName = new Map(doDroplets.map((d) => [d.name, d]));

    console.log(`[reconcile] Found ${doDroplets.length} DO droplets with artie-droplet tag`);

    // Get all DB records with DO droplet IDs
    const dbDroplets = await ctx.runQuery(internal.droplets.getAllWithDropletIds, {});

    console.log(`[reconcile] Found ${dbDroplets.length} DB droplets with DO IDs`);

    let orphansDeleted = 0;
    let staleRecordsFixed = 0;

    // Check for DB records pointing to non-existent DO droplets
    for (const dbDroplet of dbDroplets) {
      if (dbDroplet.dropletId && !doDropletIds.has(dbDroplet.dropletId)) {
        // DO droplet doesn't exist, but our DB thinks it does
        if (dbDroplet.status !== "destroyed" && dbDroplet.status !== "destroying") {
          console.log(
            `[reconcile] DB droplet ${dbDroplet._id} has DO ID ${dbDroplet.dropletId} but DO droplet doesn't exist`
          );
          await ctx.runMutation(internal.droplets.updateStatus, {
            dropletId: dbDroplet._id,
            status: "destroyed",
            reason: "reconcile_do_droplet_not_found",
          });
          staleRecordsFixed++;
        }
      }
    }

    // Check for DO droplets that don't have a matching DB record
    const dbDropletDoIds = new Set(dbDroplets.map((d) => d.dropletId).filter(Boolean));

    for (const doDroplet of doDroplets) {
      if (!dbDropletDoIds.has(doDroplet.id)) {
        // This is an orphaned DO droplet - delete it
        console.log(
          `[reconcile] Orphaned DO droplet ${doDroplet.id} (${doDroplet.name}) - deleting`
        );
        await ctx.runAction(internal.droplets.deleteDoDroplet, {
          doDropletId: doDroplet.id,
        });
        orphansDeleted++;
      }
    }

    // Also check by name for droplets that might have had DO ID not recorded
    for (const dbDroplet of dbDroplets) {
      if (!dbDroplet.dropletId) {
        const doMatch = doDropletByName.get(dbDroplet.dropletName);
        if (doMatch && dbDroplet.status === "destroyed") {
          // There's a DO droplet with this name but DB says destroyed - clean up DO
          console.log(
            `[reconcile] DO droplet ${doMatch.id} exists for destroyed DB record ${dbDroplet._id} - deleting`
          );
          await ctx.runAction(internal.droplets.deleteDoDroplet, {
            doDropletId: doMatch.id,
          });
          orphansDeleted++;
        }
      }
    }

    console.log(
      `[reconcile] Complete. Fixed ${staleRecordsFixed} stale records, deleted ${orphansDeleted} orphans`
    );
  },
});

// Clean up old destroyed records
// Should be scheduled to run every hour
export const cleanupOldRecords = internalMutation({
  handler: async (ctx) => {
    // Delete records destroyed more than 24 hours ago
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const result = await ctx.runMutation(internal.droplets.deleteOldDestroyed, {
      olderThan: cutoff,
    });

    if (result.deleted > 0) {
      console.log(`[cleanupOldRecords] Deleted ${result.deleted} old destroyed records`);
    }
  },
});
