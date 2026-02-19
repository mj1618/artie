import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { TIMEOUTS } from "./dockerContainers";

// ====================
// SCHEDULED JOBS
// ====================

// Process "requested" containers - pick up and start creating
export const processRequested = internalMutation({
  handler: async (ctx) => {
    const requestedContainers = await ctx.runQuery(
      internal.dockerContainers.getByStatus,
      {
        status: "requested",
        limit: 5,
      }
    );

    for (const container of requestedContainers) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: container._id,
        status: "creating",
        reason: "scheduler_picked_up",
      });

      await ctx.scheduler.runAfter(0, internal.dockerContainers.createContainer, {
        containerId: container._id,
      });

      console.log(
        `[docker:processRequested] Scheduled creation for container ${container._id}`
      );
    }

    if (requestedContainers.length > 0) {
      console.log(
        `[docker:processRequested] Processed ${requestedContainers.length} requested containers`
      );
    }
  },
});

// Check heartbeats - demote active to ready, or stop inactive containers
export const checkHeartbeats = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    const activeContainers = await ctx.runQuery(
      internal.dockerContainers.getByStatus,
      {
        status: "active",
      }
    );

    for (const container of activeContainers) {
      if (!container.lastHeartbeatAt) continue;

      const timeSinceHeartbeat = now - container.lastHeartbeatAt;

      if (timeSinceHeartbeat > TIMEOUTS.heartbeat_stop) {
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: container._id,
          status: "stopping",
          reason: "no_heartbeat_timeout",
        });
        console.log(
          `[docker:checkHeartbeats] Stopping container ${container._id} - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`
        );
      } else if (timeSinceHeartbeat > TIMEOUTS.heartbeat_warning) {
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: container._id,
          status: "ready",
          reason: "heartbeat_late",
        });
        console.log(
          `[docker:checkHeartbeats] Demoted container ${container._id} to ready - heartbeat late by ${Math.round(timeSinceHeartbeat / 1000)}s`
        );
      }
    }

    const readyContainers = await ctx.runQuery(
      internal.dockerContainers.getByStatus,
      {
        status: "ready",
      }
    );

    for (const container of readyContainers) {
      const heartbeatTime = container.lastHeartbeatAt || container.statusChangedAt;
      const timeSinceActivity = now - heartbeatTime;

      if (timeSinceActivity > TIMEOUTS.heartbeat_stop) {
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: container._id,
          status: "stopping",
          reason: "no_heartbeat_ready_timeout",
        });
        console.log(
          `[docker:checkHeartbeats] Stopping ready container ${container._id} - no activity for ${Math.round(timeSinceActivity / 1000)}s`
        );
      }
    }
  },
});

// Check for stuck containers in transitional states
export const checkTimeouts = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    const statesWithTimeouts: Array<{
      status: "creating" | "cloning" | "installing" | "starting";
      timeout: number;
    }> = [
      { status: "creating", timeout: TIMEOUTS.creating },
      { status: "cloning", timeout: TIMEOUTS.cloning },
      { status: "installing", timeout: TIMEOUTS.installing },
      { status: "starting", timeout: TIMEOUTS.starting },
    ];

    for (const { status, timeout } of statesWithTimeouts) {
      const timedOutContainers = await ctx.runQuery(
        internal.dockerContainers.getTimedOutContainers,
        {
          status,
          olderThan: now - timeout,
        }
      );

      for (const container of timedOutContainers) {
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: container._id,
          status: "unhealthy",
          updates: {
            errorMessage: `Timed out in ${status} state after ${Math.round(timeout / 60000)} minutes`,
          },
          reason: `${status}_timeout`,
        });
        console.log(
          `[docker:checkTimeouts] Marked container ${container._id} as unhealthy - ${status} timeout`
        );
      }
    }
  },
});

// Process "stopping" containers - start destruction
export const processStopping = internalMutation({
  handler: async (ctx) => {
    const stoppingContainers = await ctx.runQuery(
      internal.dockerContainers.getByStatus,
      {
        status: "stopping",
        limit: 10,
      }
    );

    for (const container of stoppingContainers) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: container._id,
        status: "destroying",
        reason: "destruction_started",
      });

      await ctx.scheduler.runAfter(0, internal.dockerContainers.destroyContainer, {
        containerId: container._id,
      });

      console.log(
        `[docker:processStopping] Scheduled destruction for container ${container._id}`
      );
    }

    if (stoppingContainers.length > 0) {
      console.log(
        `[docker:processStopping] Processed ${stoppingContainers.length} stopping containers`
      );
    }
  },
});

// Process "unhealthy" containers - clean them up
export const processUnhealthy = internalMutation({
  handler: async (ctx) => {
    const unhealthyContainers = await ctx.runQuery(
      internal.dockerContainers.getByStatus,
      {
        status: "unhealthy",
        limit: 10,
      }
    );

    for (const container of unhealthyContainers) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: container._id,
        status: "destroying",
        reason: "unhealthy_cleanup",
      });

      await ctx.scheduler.runAfter(0, internal.dockerContainers.destroyContainer, {
        containerId: container._id,
      });

      console.log(
        `[docker:processUnhealthy] Scheduled destruction for unhealthy container ${container._id}`
      );
    }

    if (unhealthyContainers.length > 0) {
      console.log(
        `[docker:processUnhealthy] Processed ${unhealthyContainers.length} unhealthy containers`
      );
    }
  },
});

// Clean up old destroyed records
export const cleanupOldRecords = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const result = await ctx.runMutation(
      internal.dockerContainers.deleteOldDestroyed,
      {
        olderThan: cutoff,
      }
    );

    if (result.deleted > 0) {
      console.log(
        `[docker:cleanupOldRecords] Deleted ${result.deleted} old destroyed records`
      );
    }
  },
});

// Reconcile: verify active/ready containers actually exist on the Docker host.
// Marks containers as unhealthy if they are not found on the host.
export const reconcile = internalAction({
  handler: async (ctx) => {
    const DOCKER_HOST = process.env.DOCKER_HOST_URL!;
    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) return;

    // Get containers that should be running on the host
    const [activeContainers, readyContainers] = await Promise.all([
      ctx.runQuery(internal.dockerContainers.getByStatus, { status: "active" }),
      ctx.runQuery(internal.dockerContainers.getByStatus, { status: "ready" }),
    ]);

    const containersToCheck = [...activeContainers, ...readyContainers].filter(
      (c) => c.containerId
    );
    if (containersToCheck.length === 0) return;

    // Fetch list of containers from Docker host
    let hostContainerIds: Set<string>;
    try {
      const response = await fetch(`${DOCKER_HOST}/api/containers`, {
        headers: { Authorization: `Bearer ${apiSecret}` },
      });
      if (!response.ok) return;
      const hostContainers = (await response.json()) as Array<{ id: string }>;
      hostContainerIds = new Set(hostContainers.map((c) => c.id));
    } catch {
      // Host unreachable — don't mark anything unhealthy
      return;
    }

    for (const container of containersToCheck) {
      if (!hostContainerIds.has(container.containerId!)) {
        console.log(
          `[docker:reconcile] Container ${container._id} (${container.containerId}) not found on host — marking unhealthy`
        );
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: container._id,
          status: "unhealthy",
          updates: {
            errorMessage: "Container no longer exists on the Docker host",
          },
          reason: "reconcile_not_found_on_host",
        });
      }
    }
  },
});
