import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
  internalAction,
  ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";
import { Doc, Id } from "./_generated/dataModel";
import { internal, api } from "./_generated/api";

const PARTICLE_API_URL = "https://api.runparticle.com";

export const TIMEOUTS = {
  creating: 60 * 1000,
  cloning: 5 * 60 * 1000,
  installing: 15 * 60 * 1000,
  starting: 12 * 60 * 1000,
  heartbeat_warning: 60 * 1000,
  heartbeat_stop: 5 * 60 * 1000,
};

export type ParticleStatus =
  | "requested"
  | "creating"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "active"
  | "stopping"
  | "destroyed"
  | "unhealthy";

const particleStatusValidator = v.union(
  v.literal("requested"),
  v.literal("creating"),
  v.literal("cloning"),
  v.literal("installing"),
  v.literal("starting"),
  v.literal("ready"),
  v.literal("active"),
  v.literal("stopping"),
  v.literal("destroyed"),
  v.literal("unhealthy")
);

const VALID_TRANSITIONS: Record<ParticleStatus, ParticleStatus[]> = {
  requested: ["creating", "unhealthy"],
  creating: ["cloning", "unhealthy"],
  cloning: ["installing", "unhealthy"],
  installing: ["starting", "unhealthy"],
  starting: ["ready", "unhealthy"],
  ready: ["active", "stopping", "unhealthy"],
  active: ["ready", "stopping", "unhealthy"],
  stopping: ["destroyed"],
  destroyed: [],
  unhealthy: ["stopping", "destroyed"],
};

const MAX_RETRIES = 3;

function generateParticleName(repoName: string): string {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 11);
  const random = Math.random().toString(36).substring(2, 10);
  // Max: "composure-" (10) + sanitized (11) + "-" (1) + random (8) = 30
  return `composure-${sanitized}-${random}`;
}

async function refreshGithubToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    if (data.error || !data.access_token) return null;

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : Date.now() + 8 * 60 * 60 * 1000;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function getUserGithubTokenById(
  ctx: ActionCtx,
  userId: string,
): Promise<string | undefined> {
  const profile = await ctx.runQuery(internal.users.getProfileById, { userId });
  if (!profile?.githubAccessToken) return undefined;

  const expiresAt = profile.githubTokenExpiresAt;
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    if (!profile.githubRefreshToken) {
      throw new Error("GitHub connection has expired. User needs to reconnect.");
    }

    const newTokens = await refreshGithubToken(profile.githubRefreshToken);
    if (!newTokens) {
      await ctx.runMutation(internal.users.disconnectGithubById, { userId });
      throw new Error("GitHub connection expired and could not be refreshed.");
    }

    await ctx.runMutation(internal.users.updateGithubTokensById, {
      userId,
      githubAccessToken: newTokens.accessToken,
      githubRefreshToken: newTokens.refreshToken,
      githubTokenExpiresAt: newTokens.expiresAt,
    });

    return newTokens.accessToken;
  }

  return profile.githubAccessToken;
}

async function verifyGithubBranch(
  githubToken: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return true;
  } catch {
    return true;
  }
}

async function resolveParticleBranch(
  githubToken: string,
  owner: string,
  repo: string,
  targetBranch: string,
  defaultBranch: string,
): Promise<{ branch: string; fellBack: boolean }> {
  if (targetBranch === defaultBranch) {
    return { branch: targetBranch, fellBack: false };
  }

  const exists = await verifyGithubBranch(githubToken, owner, repo, targetBranch);
  if (exists) {
    return { branch: targetBranch, fellBack: false };
  }

  console.warn(
    `[resolveParticleBranch] Branch "${targetBranch}" not found on ${owner}/${repo}, falling back to "${defaultBranch}"`,
  );
  return { branch: defaultBranch, fellBack: true };
}

// ====================
// QUERIES
// ====================

export const getByIdInternal = internalQuery({
  args: { particleId: v.id("particles") },
  handler: async (ctx, args) => {
    return await ctx.db.get("particles", args.particleId);
  },
});

export const getAuthUserIdInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

export const getForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const particles = await ctx.db
      .query("particles")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const live = particles.filter(
      (p) => p.status !== "destroyed" && p.status !== "stopping"
    );
    if (live.length > 0) {
      return live.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    const nonDestroyed = particles.filter((p) => p.status !== "destroyed");
    if (nonDestroyed.length > 0) {
      return nonDestroyed.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    return null;
  },
});

export const getForPreview = query({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const particlesForSession = await ctx.db
      .query("particles")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const liveForSession = particlesForSession.filter(
      (p) => p.status !== "destroyed" && p.status !== "stopping"
    );
    if (liveForSession.length > 0) {
      return liveForSession.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const particlesForBranch = await ctx.db
      .query("particles")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "stopping"),
          q.neq(q.field("status"), "unhealthy")
        )
      )
      .collect();

    if (particlesForBranch.length === 0) return null;

    const readyParticle = particlesForBranch.find(
      (p) => p.status === "ready" || p.status === "active"
    );
    if (readyParticle) return readyParticle;

    return particlesForBranch.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

export const getByStatus = internalQuery({
  args: {
    status: particleStatusValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("particles")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("asc");

    if (args.limit) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

export const getTimedOutParticles = internalQuery({
  args: {
    status: particleStatusValidator,
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("particles")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", args.status).lt("statusChangedAt", args.olderThan)
      )
      .collect();
  },
});

export const deleteOldDestroyed = internalMutation({
  args: {
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    const oldRecords = await ctx.db
      .query("particles")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", "destroyed").lt("statusChangedAt", args.olderThan)
      )
      .collect();

    for (const record of oldRecords) {
      await ctx.db.delete("particles", record._id);
    }

    return { deleted: oldRecords.length };
  },
});

// ====================
// MUTATIONS
// ====================

export const request = mutation({
  args: {
    sessionId: v.id("sessions"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    const repo = await ctx.db.get("repos", session.repoId);
    if (!repo) throw new Error("Repository not found");

    const team = await ctx.db.get("teams", repo.teamId);
    if (!team) throw new Error("Team not found");

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", repo.teamId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new Error("Not a team member");

    const targetBranch = args.branch ?? repo.defaultBranch;

    // Check for existing particle in this session
    const existingForSession = await ctx.db
      .query("particles")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existingForSession) {
      if (existingForSession.status === "destroyed") {
        // Continue to create new
      } else if (existingForSession.status === "stopping") {
        const now2 = Date.now();
        await ctx.db.patch("particles", existingForSession._id, {
          status: "destroyed",
          statusChangedAt: now2,
          destroyedAt: now2,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "destroyed", timestamp: now2, reason: "eager_destroy_on_restart" },
          ],
        });
      } else if (existingForSession.status === "unhealthy") {
        const now2 = Date.now();
        await ctx.db.patch("particles", existingForSession._id, {
          status: "stopping",
          statusChangedAt: now2,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "stopping", timestamp: now2, reason: "unhealthy_retry" },
          ],
        });
        await ctx.scheduler.runAfter(0, internal.particles.destroyParticle, {
          particleId: existingForSession._id,
        });
      } else {
        return existingForSession._id;
      }
    }

    // Stop old particles for this user in this repo
    const existingUserParticles = await ctx.db
      .query("particles")
      .withIndex("by_repoId", (q) => q.eq("repoId", session.repoId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.neq(q.field("sessionId"), args.sessionId),
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "stopping")
        )
      )
      .collect();

    const now = Date.now();
    for (const oldParticle of existingUserParticles) {
      console.log(
        `[particles:request] Stopping old particle ${oldParticle._id} for user ${userId}`
      );
      await ctx.db.patch("particles", oldParticle._id, {
        status: "stopping",
        statusChangedAt: now,
        statusHistory: [
          ...oldParticle.statusHistory,
          { status: "stopping", timestamp: now, reason: "new_session_created" },
        ],
      });
    }

    // Check for existing particle on same branch
    const particlesForBranch = await ctx.db
      .query("particles")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", session.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "stopping"),
          q.neq(q.field("status"), "unhealthy")
        )
      )
      .collect();

    const readyParticle = particlesForBranch.find(
      (p) => p.status === "ready" || p.status === "active"
    );
    if (readyParticle) return readyParticle._id;

    const inProgressParticle = particlesForBranch.sort(
      (a, b) => b.createdAt - a.createdAt
    )[0];
    if (inProgressParticle) return inProgressParticle._id;

    const particleName = generateParticleName(repo.githubRepo);

    const particleId = await ctx.db.insert("particles", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      teamId: repo.teamId,
      userId,
      particleName,
      status: "creating",
      retryCount: 0,
      createdAt: now,
      statusChangedAt: now,
      statusHistory: [
        { status: "creating", timestamp: now, reason: "user_request" },
      ],
      branch: targetBranch,
    });

    await ctx.scheduler.runAfter(0, internal.particles.createParticle, {
      particleId,
    });

    return particleId;
  },
});

export const requestStop = mutation({
  args: {
    particleId: v.id("particles"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle) throw new Error("Particle not found");
    if (particle.userId !== userId) throw new Error("Not authorized");

    const stoppableStates: ParticleStatus[] = [
      "ready", "active", "cloning", "installing", "starting",
      "creating", "requested", "unhealthy",
    ];

    if (!stoppableStates.includes(particle.status as ParticleStatus)) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch("particles", args.particleId, {
      status: "stopping",
      statusChangedAt: now,
      statusHistory: [
        ...particle.statusHistory,
        { status: "stopping", timestamp: now, reason: args.reason },
      ],
    });

    await ctx.scheduler.runAfter(0, internal.particles.destroyParticle, {
      particleId: args.particleId,
    });
  },
});

export const heartbeat = mutation({
  args: { particleId: v.id("particles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle || particle.userId !== userId) return;

    const now = Date.now();
    const updates: Partial<Doc<"particles">> = {
      lastHeartbeatAt: now,
    };

    if (particle.status === "ready") {
      updates.status = "active";
      updates.statusChangedAt = now;
      updates.statusHistory = [
        ...particle.statusHistory,
        { status: "active", timestamp: now, reason: "heartbeat_received" },
      ];
    }

    await ctx.db.patch("particles", args.particleId, updates);
  },
});

// ====================
// INTERNAL MUTATIONS
// ====================

export const incrementRetryCount = internalMutation({
  args: {
    particleId: v.id("particles"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle) return;

    const now = Date.now();
    await ctx.db.patch("particles", args.particleId, {
      retryCount: particle.retryCount + 1,
      errorMessage: args.errorMessage,
      statusHistory: [
        ...particle.statusHistory,
        {
          status: particle.status,
          timestamp: now,
          reason: `auto_retry_${particle.retryCount + 1}: ${args.errorMessage.slice(0, 100)}`,
        },
      ],
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    particleId: v.id("particles"),
    status: particleStatusValidator,
    updates: v.optional(
      v.object({
        previewUrl: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        buildLog: v.optional(v.string()),
        destroyedAt: v.optional(v.number()),
      })
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle) {
      console.error(`[updateStatus] Particle ${args.particleId} not found`);
      return { success: false, error: "Particle not found" };
    }

    const currentStatus = particle.status as ParticleStatus;
    const newStatus = args.status as ParticleStatus;

    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      console.warn(
        `[updateStatus] Invalid transition: ${currentStatus} -> ${newStatus} for particle ${args.particleId}`
      );
      return {
        success: false,
        error: `Invalid transition from ${currentStatus} to ${newStatus}`,
      };
    }

    const now = Date.now();
    const update: Partial<Doc<"particles">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...particle.statusHistory,
        { status: newStatus, timestamp: now, reason: args.reason },
      ],
    };

    if (args.updates) {
      if (args.updates.previewUrl !== undefined) update.previewUrl = args.updates.previewUrl;
      if (args.updates.errorMessage !== undefined) update.errorMessage = args.updates.errorMessage;
      if (args.updates.buildLog !== undefined) update.buildLog = args.updates.buildLog;
      if (args.updates.destroyedAt !== undefined) update.destroyedAt = args.updates.destroyedAt;
    }

    if (newStatus === "destroyed" && !update.destroyedAt) {
      update.destroyedAt = now;
    }

    await ctx.db.patch("particles", args.particleId, update);

    console.log(
      `[updateStatus] Particle ${args.particleId}: ${currentStatus} -> ${newStatus} (${args.reason || "no reason"})`
    );
    return { success: true };
  },
});

export const updateBranch = internalMutation({
  args: {
    particleId: v.id("particles"),
    branch: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle) return;

    await ctx.db.patch("particles", args.particleId, {
      branch: args.branch,
      statusHistory: [
        ...particle.statusHistory,
        {
          status: particle.status,
          timestamp: Date.now(),
          reason: args.reason,
        },
      ],
    });
  },
});

export const updateBuildLog = internalMutation({
  args: {
    particleId: v.id("particles"),
    buildLog: v.string(),
  },
  handler: async (ctx, args) => {
    const particle = await ctx.db.get("particles", args.particleId);
    if (!particle) return;

    await ctx.db.patch("particles", args.particleId, {
      buildLog: args.buildLog,
    });
  },
});

// ====================
// TEMPLATE QUERIES & MUTATIONS
// ====================

export const getTemplateForRepo = internalQuery({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("particleTemplates")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();
  },
});

export const saveTemplate = internalMutation({
  args: {
    repoId: v.id("repos"),
    particleName: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete any existing template for this repo
    const existing = await ctx.db
      .query("particleTemplates")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .collect();
    for (const tmpl of existing) {
      await ctx.db.delete("particleTemplates", tmpl._id);
    }

    await ctx.db.insert("particleTemplates", {
      repoId: args.repoId,
      particleName: args.particleName,
      createdAt: Date.now(),
    });
  },
});

export const deleteTemplate = internalMutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("particleTemplates")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .collect();
    for (const tmpl of existing) {
      await ctx.db.delete("particleTemplates", tmpl._id);
    }
  },
});

export const getTemplateStatus = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const template = await ctx.db
      .query("particleTemplates")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    if (!template) return null;
    return {
      particleName: template.particleName,
      createdAt: template.createdAt,
    };
  },
});

export const requestCreateTemplate = mutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) throw new Error("Repository not found");

    const team = await ctx.db.get("teams", repo.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    // Find an active/ready particle for this repo to snapshot from
    const particles = await ctx.db
      .query("particles")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "ready"),
          q.eq(q.field("status"), "active")
        )
      )
      .collect();

    if (particles.length === 0) {
      throw new Error("No active environment found. Start a session first, then create a snapshot.");
    }

    const sourceParticle = particles.sort((a, b) => b.createdAt - a.createdAt)[0];

    await ctx.scheduler.runAfter(0, internal.particles.createTemplate, {
      sourceParticleName: sourceParticle.particleName,
      repoId: args.repoId,
    });

    return { sourceParticleName: sourceParticle.particleName };
  },
});

export const requestDeleteTemplate = mutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) throw new Error("Repository not found");

    const team = await ctx.db.get("teams", repo.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    const template = await ctx.db
      .query("particleTemplates")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    if (!template) return;

    // Schedule deletion of the template particle from the API
    await ctx.scheduler.runAfter(0, internal.particles.deleteTemplateParticle, {
      particleName: template.particleName,
    });

    await ctx.db.delete("particleTemplates", template._id);
  },
});

// ====================
// ACTIONS
// ====================

async function execInParticle(
  particleName: string,
  command: string,
  apiKey: string,
  timeout = 120000,
): Promise<{ output: string; exitCode: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(
      `${PARTICLE_API_URL}/v1/particles/${particleName}/exec`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      return { output: responseText, exitCode: 1 };
    }

    // Particle API returns JSON with exit_code and output
    try {
      const result = JSON.parse(responseText);
      return {
        output: result.output ?? responseText,
        exitCode: typeof result.exit_code === "number" ? result.exit_code : 0,
      };
    } catch {
      return { output: responseText, exitCode: 0 };
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { output: "Command timed out", exitCode: 124 };
    }
    return { output: err instanceof Error ? err.message : "Unknown error", exitCode: 1 };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTransientError(error: string, statusCode?: number): boolean {
  if (statusCode && statusCode >= 500) return true;
  const transientPatterns = [
    "EOF",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "socket hang up",
    "network",
    "fetch failed",
  ];
  return transientPatterns.some((p) => error.includes(p));
}

function retryBackoffMs(retryCount: number): number {
  return Math.min(2000 * Math.pow(2, retryCount), 8000);
}

export const createParticle = internalAction({
  args: { particleId: v.id("particles") },
  handler: async (ctx, args) => {
    console.log(`[createParticle] Starting for particle ${args.particleId}`);

    const particle = await ctx.runQuery(internal.particles.getByIdInternal, {
      particleId: args.particleId,
    });
    if (!particle) {
      console.error(`[createParticle] Particle ${args.particleId} not found`);
      return;
    }

    if (particle.status === "stopping" || particle.status === "destroyed") {
      console.log(`[createParticle] Particle ${args.particleId} is ${particle.status}, aborting`);
      return;
    }

    const apiKey = process.env.PARTICLE_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: "PARTICLE_API_KEY not configured" },
        reason: "missing_config",
      });
      return;
    }

    const [repo, githubTokenResult] = await Promise.all([
      ctx.runQuery(api.projects.get, { repoId: particle.repoId }),
      getUserGithubTokenById(ctx, particle.userId).catch((err: unknown) => {
        return { error: err instanceof Error ? err.message : "GitHub token error" } as const;
      }),
    ]);

    if (!repo) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    if (typeof githubTokenResult === "object" && githubTokenResult && "error" in githubTokenResult) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: githubTokenResult.error },
        reason: "github_token_error",
      });
      return;
    }

    const githubToken = githubTokenResult as string | undefined;
    if (!githubToken) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: "GitHub token not available" },
        reason: "no_github_token",
      });
      return;
    }

    const targetBranch = particle.branch || repo.defaultBranch;
    const { branch: resolvedBranch, fellBack } = await resolveParticleBranch(
      githubToken,
      repo.githubOwner,
      repo.githubRepo,
      targetBranch,
      repo.defaultBranch,
    );

    if (fellBack) {
      await ctx.runMutation(internal.particles.updateBranch, {
        particleId: args.particleId,
        branch: resolvedBranch,
        reason: `branch_fallback: "${targetBranch}" not found, using "${resolvedBranch}"`,
      });
    }

    // Check for a template particle to duplicate from
    const template = await ctx.runQuery(internal.particles.getTemplateForRepo, {
      repoId: particle.repoId,
    });

    let fromTemplate = false;

    if (template) {
      console.log(`[createParticle] Found template ${template.particleName} for repo, attempting duplicate`);

      try {
        const dupResponse = await fetch(
          `${PARTICLE_API_URL}/v1/particles/${template.particleName}/duplicate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: particle.particleName }),
          },
        );

        if (dupResponse.ok) {
          console.log(`[createParticle] Successfully duplicated from template ${template.particleName}`);
          fromTemplate = true;

          const accountId = process.env.PARTICLE_ACCOUNT_ID;
          const accountPrefix = accountId ? `-${accountId.slice(0, 8)}` : "";
          const previewUrl = `https://${particle.particleName}${accountPrefix}.runparticle.com`;

          const statusResult = await ctx.runMutation(internal.particles.updateStatus, {
            particleId: args.particleId,
            status: "cloning",
            updates: { previewUrl },
            reason: "duplicated_from_template",
          });

          if (!statusResult?.success) {
            console.error(`[createParticle] Failed to transition to cloning after duplicate: ${statusResult?.error}`);
            try {
              await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
              });
            } catch { }
            return;
          }

          // Start the duplicated particle (it's stopped after duplication)
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}/start`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
          });

          // Set HTTP port to 3000 for Next.js dev server
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}/port`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ http_port: 3000 }),
          });

          // Set idle policy to sleep with wake-on-http
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}/idle`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ policy: "sleep" }),
          });

          await ctx.scheduler.runAfter(0, internal.particles.setupParticle, {
            particleId: args.particleId,
            githubToken,
            resolvedBranch,
            fromTemplate: true,
          });
          return;
        } else {
          const error = await dupResponse.text();
          console.warn(`[createParticle] Template duplicate failed (${dupResponse.status}): ${error}, falling back to fresh creation`);
          // Delete stale template record
          await ctx.runMutation(internal.particles.deleteTemplate, { repoId: particle.repoId });
        }
      } catch (err) {
        console.warn(`[createParticle] Template duplicate error: ${err instanceof Error ? err.message : "unknown"}, falling back to fresh creation`);
        await ctx.runMutation(internal.particles.deleteTemplate, { repoId: particle.repoId });
      }
    }

    try {
      // Create particle from scratch
      const createResponse = await fetch(`${PARTICLE_API_URL}/v1/particles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: particle.particleName,
          size: "p2",
          image: "ubuntu-24.04",
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        console.error(`[createParticle] API error: ${error}`);

        if (isTransientError(error, createResponse.status) && particle.retryCount < MAX_RETRIES - 1) {
          const delay = retryBackoffMs(particle.retryCount);
          await ctx.runMutation(internal.particles.incrementRetryCount, {
            particleId: args.particleId,
            errorMessage: error,
          });
          await ctx.scheduler.runAfter(delay, internal.particles.createParticle, {
            particleId: args.particleId,
          });
          return;
        }

        await ctx.runMutation(internal.particles.updateStatus, {
          particleId: args.particleId,
          status: "unhealthy",
          updates: {
            errorMessage: particle.retryCount > 0
              ? `Failed to create particle after ${particle.retryCount + 1} attempts: ${error}`
              : `Failed to create particle: ${error}`,
          },
          reason: particle.retryCount > 0 ? "create_failed_max_retries" : "create_failed",
        });
        return;
      }

      const particleData = await createResponse.json();
      const accountId = process.env.PARTICLE_ACCOUNT_ID;
      const accountPrefix = accountId ? `-${accountId.slice(0, 8)}` : "";
      const previewUrl = `https://${particle.particleName}${accountPrefix}.runparticle.com`;

      const statusResult = await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "cloning",
        updates: {
          previewUrl,
        },
        reason: "particle_created",
      });

      if (!statusResult?.success) {
        console.error(`[createParticle] Failed to transition to cloning: ${statusResult?.error}`);
        try {
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
          });
        } catch { }
        return;
      }

      // Set HTTP port to 3000 for Next.js dev server
      await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}/port`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ http_port: 3000 }),
      });

      // Set idle policy to sleep with wake-on-http
      await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}/idle`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ policy: "sleep" }),
      });

      console.log(`[createParticle] Particle created from scratch, proceeding to setup`);

      await ctx.scheduler.runAfter(0, internal.particles.setupParticle, {
        particleId: args.particleId,
        githubToken,
        resolvedBranch,
        fromTemplate: false,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[createParticle] Error: ${message}`);

      if (isTransientError(message) && particle.retryCount < MAX_RETRIES - 1) {
        const delay = retryBackoffMs(particle.retryCount);
        await ctx.runMutation(internal.particles.incrementRetryCount, {
          particleId: args.particleId,
          errorMessage: message,
        });
        await ctx.scheduler.runAfter(delay, internal.particles.createParticle, {
          particleId: args.particleId,
        });
        return;
      }

      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: `Create particle error: ${message}` },
        reason: "create_error",
      });
    }
  },
});

export const setupParticle = internalAction({
  args: {
    particleId: v.id("particles"),
    githubToken: v.string(),
    resolvedBranch: v.string(),
    fromTemplate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const isFromTemplate = args.fromTemplate === true;
    console.log(`[setupParticle] Starting for particle ${args.particleId} (fromTemplate: ${isFromTemplate})`);

    const particle = await ctx.runQuery(internal.particles.getByIdInternal, {
      particleId: args.particleId,
    });
    if (!particle) {
      console.error(`[setupParticle] Particle ${args.particleId} not found`);
      return;
    }

    if (particle.status === "stopping" || particle.status === "destroyed") {
      console.log(`[setupParticle] Particle ${args.particleId} is ${particle.status}, aborting`);
      return;
    }

    const apiKey = process.env.PARTICLE_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: "PARTICLE_API_KEY not configured" },
        reason: "missing_config",
      });
      return;
    }

    const repo = await ctx.runQuery(api.projects.get, { repoId: particle.repoId });
    if (!repo) {
      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    const particleName = particle.particleName;
    let buildLog = "";

    try {
      // Wait for particle to be reachable
      buildLog += `[${new Date().toISOString()}] Waiting for VM to be ready...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      let particleReachable = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        const pingResult = await execInParticle(particleName, "echo OK", apiKey, 10000);
        if (pingResult.exitCode === 0 && pingResult.output.includes("OK")) {
          particleReachable = true;
          break;
        }
        buildLog += `[${new Date().toISOString()}] VM not ready yet (attempt ${attempt + 1}/15)...\n`;
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (!particleReachable) {
        throw new Error("Particle VM not reachable after 30 seconds");
      }

      buildLog += `[${new Date().toISOString()}] VM is ready.\n`;

      if (!isFromTemplate) {
        // === FROM SCRATCH: full setup, then auto-snapshot ===

        // Install Node.js (particles come with Ubuntu, need to install Node)
        buildLog += `[${new Date().toISOString()}] Installing Node.js...\n`;
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        const nodeInstallResult = await execInParticle(
          particleName,
          `bash -c 'set -e; if which node >/dev/null 2>&1; then node --version; else curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs; fi && node --version && npm --version'`,
          apiKey,
          120000,
        );
        buildLog += nodeInstallResult.output + "\n";
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        if (nodeInstallResult.exitCode !== 0) {
          throw new Error(`Node.js installation failed (exit ${nodeInstallResult.exitCode}): ${nodeInstallResult.output.slice(-500)}`);
        }

        // Clone repository on default branch (template base)
        buildLog += `[${new Date().toISOString()}] Cloning repository...\n`;
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        const cloneUrl = `https://x-access-token:${args.githubToken}@github.com/${repo.githubOwner}/${repo.githubRepo}.git`;
        const cloneCmd = `bash -c 'rm -rf /app && GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch '"'"'${repo.defaultBranch}'"'"' '"'"'${cloneUrl}'"'"' /app 2>&1'`;
        const cloneResult = await execInParticle(particleName, cloneCmd, apiKey, TIMEOUTS.cloning);

        const cleanOutput = cloneResult.output
          .replace(/[\x00-\x1F\x7F]/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
          .trim();

        buildLog += cleanOutput + "\n";
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        if (cloneResult.exitCode !== 0) {
          throw new Error(`Clone failed (exit ${cloneResult.exitCode}): ${cleanOutput || 'No output captured'}`);
        }

        await ctx.runMutation(internal.particles.updateStatus, {
          particleId: args.particleId,
          status: "installing",
          updates: { buildLog },
          reason: "clone_complete",
        });

        // Install dependencies
        buildLog += `[${new Date().toISOString()}] Installing dependencies...\n`;
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        const installResult = await execInParticle(
          particleName,
          `bash -c 'cd /app && npm install 2>&1'`,
          apiKey,
          TIMEOUTS.installing,
        );
        buildLog += installResult.output + "\n";
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        if (installResult.exitCode !== 0) {
          throw new Error(`Install failed (exit ${installResult.exitCode}): ${installResult.output.slice(-500)}`);
        }

        // Auto-create template snapshot
        buildLog += `[${new Date().toISOString()}] Creating environment snapshot...\n`;
        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });

        try {
          // Stop the particle for snapshotting
          const stopResponse = await fetch(
            `${PARTICLE_API_URL}/v1/particles/${particleName}/stop`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          );

          if (stopResponse.ok || stopResponse.status === 409) {
            // Poll until the particle is actually stopped (exec fails)
            for (let stopAttempt = 0; stopAttempt < 30; stopAttempt++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              const pingResult = await execInParticle(particleName, "echo OK", apiKey, 5000);
              if (pingResult.exitCode !== 0 || !pingResult.output.includes("OK")) {
                break;
              }
            }

            const randomSuffix = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
            const templateName = `template-${randomSuffix}`;

            // Delete old template if exists
            const existingTemplate = await ctx.runQuery(internal.particles.getTemplateForRepo, {
              repoId: particle.repoId,
            });
            if (existingTemplate) {
              await fetch(`${PARTICLE_API_URL}/v1/particles/${existingTemplate.particleName}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
              }).catch(() => {});
            }

            // Duplicate as template
            console.log(`[setupParticle] Duplicating particle "${particleName}" (${particleName.length} chars) -> "${templateName}" (${templateName.length} chars)`);
            const dupResponse = await fetch(
              `${PARTICLE_API_URL}/v1/particles/${particleName}/duplicate`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ name: templateName }),
              },
            );

            if (dupResponse.ok) {
              await ctx.runMutation(internal.particles.saveTemplate, {
                repoId: particle.repoId,
                particleName: templateName,
              });
              buildLog += `[${new Date().toISOString()}] Snapshot created.\n`;
            } else {
              const error = await dupResponse.text();
              console.warn(`[setupParticle] Auto-snapshot duplicate failed (${dupResponse.status}): ${error}`);
              buildLog += `[${new Date().toISOString()}] Snapshot failed (${dupResponse.status}: ${error.slice(0, 200)}), continuing without template.\n`;
            }
          } else {
            const stopError = await stopResponse.text().catch(() => "");
            console.warn(`[setupParticle] Auto-snapshot stop failed (${stopResponse.status}): ${stopError}`);
            buildLog += `[${new Date().toISOString()}] Snapshot failed: stop returned ${stopResponse.status} (${stopError.slice(0, 200)}), continuing without template.\n`;
          }

          // Start the particle back up
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particleName}/start`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
          });

          // Wait for particle to be reachable again after restart
          let reachable = false;
          for (let attempt = 0; attempt < 15; attempt++) {
            const pingResult = await execInParticle(particleName, "echo OK", apiKey, 10000);
            if (pingResult.exitCode === 0 && pingResult.output.includes("OK")) {
              reachable = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          if (!reachable) {
            throw new Error("Particle VM not reachable after snapshot restart");
          }
        } catch (snapshotErr) {
          // If snapshot fails, try to start particle back up and continue
          console.error(`[setupParticle] Auto-snapshot error: ${snapshotErr instanceof Error ? snapshotErr.message : "unknown"}`);
          buildLog += `[${new Date().toISOString()}] Snapshot error, continuing setup.\n`;
          await fetch(`${PARTICLE_API_URL}/v1/particles/${particleName}/start`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
          }).catch(() => {});

          // Wait for particle to be reachable
          for (let attempt = 0; attempt < 15; attempt++) {
            const pingResult = await execInParticle(particleName, "echo OK", apiKey, 10000);
            if (pingResult.exitCode === 0 && pingResult.output.includes("OK")) break;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        await ctx.runMutation(internal.particles.updateBuildLog, {
          particleId: args.particleId,
          buildLog,
        });
      }

      // === TEMPLATE PATH: git fetch + checkout branch (runs for both from-template and after auto-snapshot) ===
      buildLog += `[${new Date().toISOString()}] Fetching latest code...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      // Unshallow the clone and set up the remote with a fresh token
      const cloneUrl = `https://x-access-token:${args.githubToken}@github.com/${repo.githubOwner}/${repo.githubRepo}.git`;
      const fetchCmd = `bash -c 'cd /app && git remote set-url origin '"'"'${cloneUrl}'"'"' && git fetch --unshallow origin 2>&1 || git fetch origin 2>&1'`;
      const fetchResult = await execInParticle(particleName, fetchCmd, apiKey, TIMEOUTS.cloning);

      const cleanFetchOutput = fetchResult.output
        .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
        .trim();
      buildLog += cleanFetchOutput + "\n";

      if (fetchResult.exitCode !== 0) {
        throw new Error(`Git fetch failed (exit ${fetchResult.exitCode}): ${cleanFetchOutput}`);
      }

      // Checkout the target branch (create from default branch if it doesn't exist on remote)
      const checkoutCmd = `bash -c 'cd /app && (git checkout -B '"'"'${args.resolvedBranch}'"'"' '"'"'origin/${args.resolvedBranch}'"'"' 2>&1 || git checkout -b '"'"'${args.resolvedBranch}'"'"' '"'"'origin/${repo.defaultBranch}'"'"' 2>&1)'`;
      const checkoutResult = await execInParticle(particleName, checkoutCmd, apiKey, 30000);

      const cleanCheckoutOutput = checkoutResult.output
        .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
        .trim();
      buildLog += cleanCheckoutOutput + "\n";

      if (checkoutResult.exitCode !== 0) {
        throw new Error(`Git checkout failed (exit ${checkoutResult.exitCode}): ${cleanCheckoutOutput}`);
      }

      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "installing",
        updates: { buildLog },
        reason: "fetch_complete",
      });

      // Run incremental npm install
      buildLog += `[${new Date().toISOString()}] Running npm install...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      const npmInstallResult = await execInParticle(
        particleName,
        `bash -c 'cd /app && npm install 2>&1'`,
        apiKey,
        TIMEOUTS.installing,
      );
      buildLog += npmInstallResult.output + "\n";
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      if (npmInstallResult.exitCode !== 0) {
        throw new Error(`Install failed (exit ${npmInstallResult.exitCode}): ${npmInstallResult.output.slice(-500)}`);
      }

      // Install Claude Code (both paths)
      buildLog += `[${new Date().toISOString()}] Checking Claude Code...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      const claudeCheckResult = await execInParticle(
        particleName,
        `bash -c 'which claude && claude --version 2>&1 || echo "NOT_INSTALLED"'`,
        apiKey,
        10000,
      );

      if (claudeCheckResult.output.includes("NOT_INSTALLED")) {
        buildLog += `Installing Claude Code...\n`;
        const claudeInstallResult = await execInParticle(
          particleName,
          `bash -c 'npm install -g @anthropic-ai/claude-code 2>&1 && mkdir -p ~/.claude && echo '"'"'{"hasCompletedOnboarding":true}'"'"' > ~/.claude/settings.json'`,
          apiKey,
          120000,
        );
        buildLog += claudeInstallResult.output + "\n";
      } else {
        buildLog += `Claude Code already installed: ${claudeCheckResult.output.trim()}\n`;
        await execInParticle(
          particleName,
          `bash -c 'mkdir -p ~/.claude && test -f ~/.claude/settings.json || echo '"'"'{"hasCompletedOnboarding":true}'"'"' > ~/.claude/settings.json'`,
          apiKey,
          5000,
        );
      }
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      // Write env vars (both paths - env vars may have changed)
      if (repo.envVars && repo.envVars.length > 0) {
        buildLog += `[${new Date().toISOString()}] Writing .env file...\n`;
        const envContent = repo.envVars
          .map((e: { key: string; value: string }) => `${e.key}=${e.value}`)
          .join("\n");
        const b64 = Buffer.from(envContent).toString("base64");
        await execInParticle(
          particleName,
          `bash -c 'cd /app && printf "%s" "${b64}" | base64 -d > .env'`,
          apiKey,
          10000,
        );
      }

      if (repo.externalConvexUrl) {
        await execInParticle(
          particleName,
          `bash -c 'echo "NEXT_PUBLIC_CONVEX_URL=${repo.externalConvexUrl}" >> /app/.env'`,
          apiKey,
          10000,
        );
      }
      if (repo.externalConvexDeployment) {
        await execInParticle(
          particleName,
          `bash -c 'echo "CONVEX_DEPLOYMENT=${repo.externalConvexDeployment}" >> /app/.env'`,
          apiKey,
          10000,
        );
      }

      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "starting",
        updates: { buildLog },
        reason: "install_complete",
      });

      // Start the dev server
      buildLog += `[${new Date().toISOString()}] Starting dev server...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      const startCmd = `bash -c 'nohup sh -c "cd /app && (npm run dev 2>&1)" > /tmp/devserver.log 2>&1 &'`;
      await execInParticle(particleName, startCmd, apiKey, 10000);

      buildLog += `[${new Date().toISOString()}] Waiting for server to be ready...\n`;
      await ctx.runMutation(internal.particles.updateBuildLog, {
        particleId: args.particleId,
        buildLog,
      });

      let serverReady = false;
      let lastDevLogLength = 0;

      // Wait up to 10 minutes for server to compile
      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Read dev server logs
        const devLogResult = await execInParticle(
          particleName,
          `bash -c 'cat /tmp/devserver.log 2>/dev/null || echo ""'`,
          apiKey,
          10000,
        );
        const devLogContent = devLogResult.output;
        if (devLogContent.length > lastDevLogLength) {
          const newLogContent = devLogContent.substring(lastDevLogLength);
          buildLog += newLogContent;
          lastDevLogLength = devLogContent.length;
          await ctx.runMutation(internal.particles.updateBuildLog, {
            particleId: args.particleId,
            buildLog,
          });
        }

        // Check if server is responding
        const checkResult = await execInParticle(
          particleName,
          `bash -c 'curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000 2>/dev/null || true'`,
          apiKey,
          10000,
        );
        const httpCodeMatch = checkResult.output.match(/([23]\d\d)/);
        if (httpCodeMatch) {
          serverReady = true;
          break;
        }

        if (i > 0 && i % 5 === 0) {
          buildLog += `[${new Date().toISOString()}] Still waiting for server (${i * 3}s elapsed)...\n`;
          await ctx.runMutation(internal.particles.updateBuildLog, {
            particleId: args.particleId,
            buildLog,
          });
        }
      }

      if (!serverReady) {
        const finalDevLogResult = await execInParticle(
          particleName,
          `bash -c 'cat /tmp/devserver.log 2>/dev/null || echo ""'`,
          apiKey,
          10000,
        );
        if (finalDevLogResult.output.length > lastDevLogLength) {
          buildLog += finalDevLogResult.output.substring(lastDevLogLength);
        }
        throw new Error("Dev server failed to start within timeout (6 minutes)");
      }

      buildLog += `\n[${new Date().toISOString()}] Server ready!\n`;

      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "ready",
        updates: { buildLog },
        reason: "server_ready",
      });

      console.log(`[setupParticle] Particle ${args.particleId} is ready`);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[setupParticle] Error: ${message}`);
      buildLog += `[${new Date().toISOString()}] ERROR: ${message}\n`;

      await ctx.runMutation(internal.particles.updateStatus, {
        particleId: args.particleId,
        status: "unhealthy",
        updates: { errorMessage: message, buildLog },
        reason: "setup_failed",
      });
    }
  },
});

export const deleteTemplateParticle = internalAction({
  args: { particleName: v.string() },
  handler: async (ctx, args) => {
    const apiKey = process.env.PARTICLE_API_KEY;
    if (!apiKey) return;

    try {
      await fetch(`${PARTICLE_API_URL}/v1/particles/${args.particleName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      console.log(`[deleteTemplateParticle] Deleted template particle ${args.particleName}`);
    } catch (err) {
      console.error(`[deleteTemplateParticle] Error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  },
});

export const createTemplate = internalAction({
  args: {
    sourceParticleName: v.string(),
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.PARTICLE_API_KEY;
    if (!apiKey) {
      console.error(`[createTemplate] PARTICLE_API_KEY not configured`);
      return;
    }

    // Check if a template already exists for this repo
    const existing = await ctx.runQuery(internal.particles.getTemplateForRepo, {
      repoId: args.repoId,
    });

    // Delete old template particle if it exists
    if (existing) {
      console.log(`[createTemplate] Deleting old template ${existing.particleName}`);
      await fetch(`${PARTICLE_API_URL}/v1/particles/${existing.particleName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => {});
    }

    const randomSuffix = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
    const templateName = `template-${randomSuffix}`;

    try {
      // Stop the source particle so we can duplicate it
      console.log(`[createTemplate] Stopping source particle ${args.sourceParticleName} for duplication`);
      const stopResponse = await fetch(
        `${PARTICLE_API_URL}/v1/particles/${args.sourceParticleName}/stop`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );

      if (!stopResponse.ok && stopResponse.status !== 409) {
        const error = await stopResponse.text();
        console.error(`[createTemplate] Failed to stop source (${stopResponse.status}): ${error}`);
        return;
      }

      // Wait briefly for the particle to fully stop
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Duplicate the stopped particle to create the template
      console.log(`[createTemplate] Duplicating ${args.sourceParticleName} -> ${templateName}`);
      const dupResponse = await fetch(
        `${PARTICLE_API_URL}/v1/particles/${args.sourceParticleName}/duplicate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: templateName }),
        },
      );

      if (!dupResponse.ok) {
        const error = await dupResponse.text();
        console.error(`[createTemplate] Duplicate failed (${dupResponse.status}): ${error}`);
        // Start the source back up regardless
        await fetch(`${PARTICLE_API_URL}/v1/particles/${args.sourceParticleName}/start`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return;
      }

      // Start the source particle back up immediately
      console.log(`[createTemplate] Starting source particle ${args.sourceParticleName} back up`);
      await fetch(`${PARTICLE_API_URL}/v1/particles/${args.sourceParticleName}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      // Save the template record (template particle stays stopped)
      await ctx.runMutation(internal.particles.saveTemplate, {
        repoId: args.repoId,
        particleName: templateName,
      });

      console.log(`[createTemplate] Template ${templateName} created for repo ${args.repoId}`);
    } catch (err) {
      console.error(`[createTemplate] Error: ${err instanceof Error ? err.message : "unknown"}`);
      // Make sure source particle is started back up
      await fetch(`${PARTICLE_API_URL}/v1/particles/${args.sourceParticleName}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => {});
    }
  },
});

export const destroyParticle = internalAction({
  args: { particleId: v.id("particles") },
  handler: async (ctx, args) => {
    console.log(`[destroyParticle] Starting for particle ${args.particleId}`);

    const particle = await ctx.runQuery(internal.particles.getByIdInternal, {
      particleId: args.particleId,
    });
    if (!particle) {
      console.error(`[destroyParticle] Particle ${args.particleId} not found`);
      return;
    }

    const apiKey = process.env.PARTICLE_API_KEY;
    if (apiKey && particle.particleName) {
      try {
        console.log(`[destroyParticle] Deleting particle ${particle.particleName}`);
        const response = await fetch(`${PARTICLE_API_URL}/v1/particles/${particle.particleName}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          const error = await response.text();
          console.error(`[destroyParticle] Delete API error: ${error}`);
        }
      } catch (err) {
        console.error(
          `[destroyParticle] Failed to delete via API: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    await ctx.runMutation(internal.particles.updateStatus, {
      particleId: args.particleId,
      status: "destroyed",
      updates: { destroyedAt: Date.now() },
      reason: "particle_deleted",
    });

    console.log(`[destroyParticle] Particle ${args.particleId} destroyed`);
  },
});

// Internal: test particle creation without auth (for CLI testing)
export const testCreateParticle = internalAction({
  args: {
    repoId: v.id("repos"),
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ particleId: string; sessionId: string; particleName: string }> => {
    const repo = await ctx.runQuery(api.projects.get, { repoId: args.repoId });
    if (!repo) throw new Error("Repo not found");

    // Create a session
    const sessionId: string = await ctx.runMutation(internal.sessions.createInternal, {
      repoId: args.repoId,
      userId: args.userId,
    }) as string;

    const targetBranch = repo.defaultBranch;
    const particleName = generateParticleName(repo.githubRepo);

    const particleId: string = await ctx.runMutation(internal.particles.insertParticle, {
      sessionId: sessionId as Id<"sessions">,
      repoId: args.repoId,
      teamId: repo.teamId,
      userId: args.userId,
      particleName,
      branch: targetBranch,
    }) as string;

    console.log(`[testCreateParticle] Created particle ${particleId} (${particleName}) for session ${sessionId}`);

    await ctx.scheduler.runAfter(0, internal.particles.createParticle, {
      particleId: particleId as Id<"particles">,
    });

    return { particleId, sessionId, particleName };
  },
});

export const insertParticle = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    teamId: v.id("teams"),
    userId: v.string(),
    particleName: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("particles", {
      sessionId: args.sessionId,
      repoId: args.repoId,
      teamId: args.teamId,
      userId: args.userId,
      particleName: args.particleName,
      status: "creating",
      retryCount: 0,
      createdAt: now,
      statusChangedAt: now,
      statusHistory: [
        { status: "creating", timestamp: now, reason: "test_request" },
      ],
      branch: args.branch,
    });
  },
});
