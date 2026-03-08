import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { TIMEOUTS, ParticleStatus } from "./particles";

export const checkHeartbeats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const warningThreshold = now - TIMEOUTS.heartbeat_warning;
    const stopThreshold = now - TIMEOUTS.heartbeat_stop;

    const activeParticles = await ctx.db
      .query("particles")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    for (const particle of activeParticles) {
      const lastHeartbeat = particle.lastHeartbeatAt ?? particle.statusChangedAt;

      if (lastHeartbeat < stopThreshold) {
        console.log(
          `[particleScheduler:checkHeartbeats] Stopping particle ${particle._id} due to missed heartbeats`
        );
        await ctx.db.patch("particles", particle._id, {
          status: "stopping",
          statusChangedAt: now,
          statusHistory: [
            ...particle.statusHistory,
            { status: "stopping", timestamp: now, reason: "heartbeat_timeout" },
          ],
        });
        await ctx.scheduler.runAfter(0, internal.particles.destroyParticle, {
          particleId: particle._id,
        });
      } else if (lastHeartbeat < warningThreshold) {
        if (particle.status !== "ready") {
          await ctx.db.patch("particles", particle._id, {
            status: "ready",
            statusChangedAt: now,
            statusHistory: [
              ...particle.statusHistory,
              { status: "ready", timestamp: now, reason: "heartbeat_warning" },
            ],
          });
        }
      }
    }
  },
});

export const checkTimeouts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const statusTimeouts: { status: ParticleStatus; timeout: number }[] = [
      { status: "creating", timeout: TIMEOUTS.creating },
      { status: "cloning", timeout: TIMEOUTS.cloning },
      { status: "installing", timeout: TIMEOUTS.installing },
      { status: "starting", timeout: TIMEOUTS.starting },
    ];

    for (const { status, timeout } of statusTimeouts) {
      const threshold = now - timeout;
      const timedOut = await ctx.db
        .query("particles")
        .withIndex("by_status_and_statusChangedAt", (q) =>
          q.eq("status", status).lt("statusChangedAt", threshold)
        )
        .collect();

      for (const particle of timedOut) {
        console.log(
          `[particleScheduler:checkTimeouts] Marking particle ${particle._id} as unhealthy (stuck in ${status})`
        );
        await ctx.db.patch("particles", particle._id, {
          status: "unhealthy",
          statusChangedAt: now,
          errorMessage: `Timed out in ${status} state after ${timeout / 1000}s`,
          statusHistory: [
            ...particle.statusHistory,
            { status: "unhealthy", timestamp: now, reason: `timeout_in_${status}` },
          ],
        });
      }
    }
  },
});

export const processStopping = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stoppingParticles = await ctx.db
      .query("particles")
      .withIndex("by_status", (q) => q.eq("status", "stopping"))
      .take(10);

    for (const particle of stoppingParticles) {
      await ctx.scheduler.runAfter(0, internal.particles.destroyParticle, {
        particleId: particle._id,
      });
    }
  },
});

export const processUnhealthy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const unhealthyParticles = await ctx.db
      .query("particles")
      .withIndex("by_status", (q) => q.eq("status", "unhealthy"))
      .take(10);

    for (const particle of unhealthyParticles) {
      console.log(
        `[particleScheduler:processUnhealthy] Stopping unhealthy particle ${particle._id}`
      );
      await ctx.db.patch("particles", particle._id, {
        status: "stopping",
        statusChangedAt: now,
        statusHistory: [
          ...particle.statusHistory,
          { status: "stopping", timestamp: now, reason: "cleanup_unhealthy" },
        ],
      });
      await ctx.scheduler.runAfter(0, internal.particles.destroyParticle, {
        particleId: particle._id,
      });
    }
  },
});

export const cleanupOldRecords = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const result = await ctx.runMutation(internal.particles.deleteOldDestroyed, {
      olderThan: oneHourAgo,
    });
    if (result.deleted > 0) {
      console.log(
        `[particleScheduler:cleanupOldRecords] Deleted ${result.deleted} old particle records`
      );
    }
  },
});

export const reconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.PARTICLE_API_KEY;
    if (!apiKey) {
      console.warn("[particleScheduler:reconcile] PARTICLE_API_KEY not configured");
      return;
    }

    const activeStatuses: ParticleStatus[] = ["ready", "active", "cloning", "installing", "starting"];

    for (const status of activeStatuses) {
      const particles = await ctx.runQuery(internal.particles.getByStatus, {
        status,
        limit: 50,
      });

      for (const particle of particles) {
        if (!particle.particleName) continue;

        try {
          const response = await fetch(
            `${process.env.PARTICLE_API_URL ?? "https://api.runparticle.com"}/v1/particles/${particle.particleName}`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${apiKey}` },
            }
          );

          if (response.status === 404) {
            console.log(
              `[particleScheduler:reconcile] Particle ${particle.particleName} not found on API, marking as unhealthy`
            );
            await ctx.runMutation(internal.particles.updateStatus, {
              particleId: particle._id,
              status: "unhealthy",
              updates: { errorMessage: "Particle not found on RunParticle API" },
              reason: "reconcile_not_found",
            });
          }
        } catch (err) {
          console.warn(
            `[particleScheduler:reconcile] Failed to check particle ${particle.particleName}: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }
    }
  },
});
