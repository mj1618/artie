import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
  ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";
import { Doc } from "./_generated/dataModel";
import { internal, api } from "./_generated/api";

// Constants
const DOCKER_HOST = process.env.DOCKER_HOST_URL!;

// Timeouts
export const TIMEOUTS = {
  creating: 60 * 1000,
  cloning: 5 * 60 * 1000,
  installing: 15 * 60 * 1000,
  starting: 2 * 60 * 1000,
  heartbeat_warning: 60 * 1000,
  heartbeat_stop: 5 * 60 * 1000,
};

// Status type
export type DockerContainerStatus =
  | "requested"
  | "creating"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "active"
  | "stopping"
  | "destroying"
  | "destroyed"
  | "unhealthy";

// Status validator
const containerStatusValidator = v.union(
  v.literal("requested"),
  v.literal("creating"),
  v.literal("cloning"),
  v.literal("installing"),
  v.literal("starting"),
  v.literal("ready"),
  v.literal("active"),
  v.literal("stopping"),
  v.literal("destroying"),
  v.literal("destroyed"),
  v.literal("unhealthy")
);

// Valid state transitions
const VALID_TRANSITIONS: Record<DockerContainerStatus, DockerContainerStatus[]> = {
  requested: ["creating", "unhealthy"],
  creating: ["cloning", "unhealthy"],
  cloning: ["creating", "installing", "unhealthy"],
  installing: ["starting", "unhealthy"],
  starting: ["ready", "unhealthy"],
  ready: ["active", "stopping", "unhealthy"],
  active: ["ready", "stopping", "unhealthy"],
  stopping: ["destroying"],
  destroying: ["destroyed", "unhealthy"],
  destroyed: [],
  unhealthy: ["destroying"],
};

// Max retries
const MAX_RETRIES = 3;

// Generate a unique container name. Uses a random suffix so that
// re-creating a container for the same session never collides with
// a still-being-destroyed predecessor that shares the same sessionId.
function generateContainerName(repoName: string): string {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const random = Math.random().toString(36).substring(2, 10);
  return `composure-docker-${sanitized}-${random}`;
}

// Generate API secret
function generateApiSecret(): string {
  const uuid1 = crypto.randomUUID().replace(/-/g, "");
  const uuid2 = crypto.randomUUID().replace(/-/g, "");
  return (uuid1 + uuid2).slice(0, 64);
}

/**
 * Refresh GitHub access token using refresh token.
 */
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

/**
 * Get a user's GitHub token by user ID, refreshing if expired.
 */
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

/**
 * Verify a branch exists on GitHub. Returns the branch name if it exists,
 * or null if it doesn't. Uses the GitHub refs API which is lightweight.
 */
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
    return response.status === 200;
  } catch {
    // Network error — assume branch exists to avoid blocking on transient failures
    return true;
  }
}

/**
 * Resolve the target branch for a container, verifying it exists on GitHub.
 * Falls back to the repo's default branch if the target doesn't exist.
 * Returns { branch, wasResolved } to indicate whether a fallback occurred.
 */
async function resolveContainerBranch(
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
    `[resolveContainerBranch] Branch "${targetBranch}" not found on ${owner}/${repo}, falling back to "${defaultBranch}"`,
  );
  return { branch: defaultBranch, fellBack: true };
}

// ====================
// QUERIES
// ====================

// Internal query to get container by ID
export const getByIdInternal = internalQuery({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    return await ctx.db.get("dockerContainers", args.containerId);
  },
});

export const getByContainerId = internalQuery({
  args: { containerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dockerContainers")
      .withIndex("by_containerId", (q) => q.eq("containerId", args.containerId))
      .first();
  },
});

export const debugListAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("dockerContainers").order("desc").take(10);
  },
});

export const forceDestroy = internalMutation({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) return { success: false, error: "not found" };
    const now = Date.now();
    await ctx.db.patch("dockerContainers", args.containerId, {
      status: "destroyed",
      statusChangedAt: now,
      destroyedAt: now,
      statusHistory: [
        ...container.statusHistory,
        { status: "destroyed", timestamp: now, reason: "force_destroy" },
      ],
    });
    return { success: true };
  },
});

// Update the branch on a container (used when falling back from a non-existent branch)
export const updateBranch = internalMutation({
  args: {
    containerId: v.id("dockerContainers"),
    branch: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) return;

    await ctx.db.patch("dockerContainers", args.containerId, {
      branch: args.branch,
      statusHistory: [
        ...container.statusHistory,
        {
          status: container.status,
          timestamp: Date.now(),
          reason: args.reason,
        },
      ],
    });
  },
});

// Debug: force destroy a container by ID (no auth required - for debugging only)
export const debugForceDestroy = mutation({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) return { success: false, error: "Not found" };
    const now = Date.now();
    await ctx.db.patch("dockerContainers", args.containerId, {
      status: "destroyed",
      statusChangedAt: now,
      destroyedAt: now,
      statusHistory: [
        ...container.statusHistory,
        { status: "destroyed", timestamp: now, reason: "debug_force_destroy" },
      ],
    });
    return { success: true };
  },
});

// Internal query to get containers by containerName (for callback validation)
export const getByContainerName = internalQuery({
  args: { containerName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dockerContainers")
      .withIndex("by_containerName", (q) => q.eq("containerName", args.containerName))
      .collect();
  },
});

// Get container for a session (authenticated).
// When multiple records exist (e.g. old one destroying, new one creating),
// prefer the most recently created non-terminal container.
export const getForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const containers = await ctx.db
      .query("dockerContainers")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const live = containers.filter(
      (c) => c.status !== "destroyed" && c.status !== "destroying" && c.status !== "stopping"
    );
    if (live.length > 0) {
      return live.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    const nonDestroyed = containers.filter((c) => c.status !== "destroyed");
    if (nonDestroyed.length > 0) {
      return nonDestroyed.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    return null;
  },
});

// Get active container for a repo+branch (authenticated)
export const getForRepo = query({
  args: {
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const containers = await ctx.db
      .query("dockerContainers")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying"),
          q.neq(q.field("status"), "stopping"),
          q.neq(q.field("status"), "unhealthy")
        )
      )
      .collect();

    if (containers.length === 0) return null;

    const readyContainer = containers.find(
      (c) => c.status === "ready" || c.status === "active"
    );
    if (readyContainer) return readyContainer;

    return containers.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

// Get container for preview (combines session + repo/branch lookup)
export const getForPreview = query({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const containersForSession = await ctx.db
      .query("dockerContainers")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const liveForSession = containersForSession.filter(
      (c) => c.status !== "destroyed" && c.status !== "destroying" && c.status !== "stopping"
    );
    if (liveForSession.length > 0) {
      return liveForSession.sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const containersForBranch = await ctx.db
      .query("dockerContainers")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying"),
          q.neq(q.field("status"), "stopping"),
          q.neq(q.field("status"), "unhealthy")
        )
      )
      .collect();

    if (containersForBranch.length === 0) return null;

    const readyContainer = containersForBranch.find(
      (c) => c.status === "ready" || c.status === "active"
    );
    if (readyContainer) return readyContainer;

    return containersForBranch.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

// Get containers by status (for scheduler)
export const getByStatus = internalQuery({
  args: {
    status: containerStatusValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("dockerContainers")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("asc");

    if (args.limit) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

// Get containers stuck in a status older than a threshold (for scheduler timeouts)
export const getTimedOutContainers = internalQuery({
  args: {
    status: containerStatusValidator,
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dockerContainers")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", args.status).lt("statusChangedAt", args.olderThan)
      )
      .collect();
  },
});

// Delete old destroyed records (for cleanup)
export const deleteOldDestroyed = internalMutation({
  args: {
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    const oldRecords = await ctx.db
      .query("dockerContainers")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", "destroyed").lt("statusChangedAt", args.olderThan)
      )
      .collect();

    for (const record of oldRecords) {
      await ctx.db.delete("dockerContainers", record._id);
    }

    return { deleted: oldRecords.length };
  },
});

// ====================
// MUTATIONS
// ====================

// Request a new container (called by frontend)
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

    // Check for existing container for this session
    const existingForSession = await ctx.db
      .query("dockerContainers")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existingForSession) {
      if (existingForSession.status === "destroyed") {
        // Continue to create new
      } else if (existingForSession.status === "stopping") {
        // Eagerly kick off destruction so the host container is removed ASAP,
        // rather than waiting for the next scheduler cron tick.
        const now2 = Date.now();
        await ctx.db.patch("dockerContainers", existingForSession._id, {
          status: "destroying",
          statusChangedAt: now2,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "destroying", timestamp: now2, reason: "eager_destroy_on_restart" },
          ],
        });
        await ctx.scheduler.runAfter(0, internal.dockerContainers.destroyContainer, {
          containerId: existingForSession._id,
        });
      } else if (existingForSession.status === "destroying") {
        // Already being destroyed — proceed to create new
      } else if (existingForSession.status === "unhealthy") {
        const now = Date.now();
        await ctx.db.patch("dockerContainers", existingForSession._id, {
          status: "creating",
          statusChangedAt: now,
          errorMessage: undefined,
          retryCount: 0,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "creating", timestamp: now, reason: "user_retry_immediate" },
          ],
        });
        await ctx.scheduler.runAfter(0, internal.dockerContainers.createContainer, {
          containerId: existingForSession._id,
        });
        return existingForSession._id;
      } else {
        return existingForSession._id;
      }
    }

    // Stop any existing containers for this user on this repo (from other sessions)
    const existingUserContainers = await ctx.db
      .query("dockerContainers")
      .withIndex("by_repoId", (q) => q.eq("repoId", session.repoId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.neq(q.field("sessionId"), args.sessionId),
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying"),
          q.neq(q.field("status"), "stopping")
        )
      )
      .collect();

    const now = Date.now();
    for (const oldContainer of existingUserContainers) {
      console.log(
        `[dockerContainers:request] Stopping old container ${oldContainer._id} for user ${userId}`
      );
      await ctx.db.patch("dockerContainers", oldContainer._id, {
        status: "stopping",
        statusChangedAt: now,
        statusHistory: [
          ...oldContainer.statusHistory,
          { status: "stopping", timestamp: now, reason: "new_session_created" },
        ],
      });
    }

    // Check for existing active container on same repo+branch
    const containersForBranch = await ctx.db
      .query("dockerContainers")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", session.repoId).eq("branch", targetBranch)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying"),
          q.neq(q.field("status"), "stopping"),
          q.neq(q.field("status"), "unhealthy")
        )
      )
      .collect();

    const readyContainer = containersForBranch.find(
      (c) => c.status === "ready" || c.status === "active"
    );
    if (readyContainer) return readyContainer._id;

    const inProgressContainer = containersForBranch.sort(
      (a, b) => b.createdAt - a.createdAt
    )[0];
    if (inProgressContainer) return inProgressContainer._id;

    const apiSecret = generateApiSecret();

    // Check if a cached repo image exists
    const repoImage = await ctx.db
      .query("dockerRepoImages")
      .withIndex("by_repoId", (q) => q.eq("repoId", session.repoId))
      .filter((q) => q.eq(q.field("status"), "ready"))
      .first();

    // Try repo-specific pool first (has image + node_modules volume pre-attached)
    const repoPoolContainer = repoImage
      ? await ctx.db
          .query("dockerContainerPool")
          .withIndex("by_status_repoId", (q) =>
            q.eq("status", "ready").eq("repoId", session.repoId)
          )
          .order("asc")
          .first()
      : null;

    // Fall back to generic pool
    const poolContainer = repoPoolContainer
      ?? await ctx.db
          .query("dockerContainerPool")
          .withIndex("by_status", (q) => q.eq("status", "ready"))
          .order("asc")
          .filter((q) => q.eq(q.field("repoId"), undefined))
          .first();

    if (poolContainer) {
      await ctx.db.patch("dockerContainerPool", poolContainer._id, {
        status: "assigned",
        assignedAt: now,
      });

      const containerId = await ctx.db.insert("dockerContainers", {
        sessionId: args.sessionId,
        repoId: session.repoId,
        teamId: repo.teamId,
        userId,
        containerName: poolContainer.containerName,
        containerId: poolContainer.containerId,
        hostPort: poolContainer.hostPort,
        previewUrl: `http://${process.env.DOCKER_HOST!}:${poolContainer.hostPort}`,
        logsUrl: `${process.env.DOCKER_HOST_URL!}/api/containers/${poolContainer.containerId}/logs`,
        terminalUrl: `${process.env.DOCKER_HOST_URL!.replace(/^http/, "ws")}/api/containers/${poolContainer.containerId}/terminal`,
        status: "cloning",
        apiSecret,
        retryCount: 0,
        createdAt: now,
        statusChangedAt: now,
        statusHistory: [
          { status: "cloning", timestamp: now, reason: poolContainer.repoId ? "assigned_from_repo_pool" : "assigned_from_pool" },
        ],
        branch: targetBranch,
      });

      console.log(`[dockerContainers:request] Assigned ${poolContainer.repoId ? "repo" : "generic"} pool container ${poolContainer.containerName} to session`);

      await ctx.scheduler.runAfter(0, internal.dockerContainers.setupContainer, {
        containerId,
      });

      return containerId;
    }

    // No pool container available - create new container
    const containerName = generateContainerName(repo.githubRepo);

    const containerId = await ctx.db.insert("dockerContainers", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      teamId: repo.teamId,
      userId,
      containerName,
      status: "creating",
      apiSecret,
      retryCount: 0,
      createdAt: now,
      statusChangedAt: now,
      statusHistory: [
        { status: "creating", timestamp: now, reason: "user_request_no_pool" },
      ],
      branch: targetBranch,
    });

    await ctx.scheduler.runAfter(0, internal.dockerContainers.createContainer, {
      containerId,
    });

    return containerId;
  },
});

// Request stop (called by frontend)
export const requestStop = mutation({
  args: {
    containerId: v.id("dockerContainers"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) throw new Error("Container not found");
    if (container.userId !== userId) throw new Error("Not authorized");

    const stoppableStates: DockerContainerStatus[] = [
      "ready", "active", "cloning", "installing", "starting",
      "creating", "requested", "unhealthy",
    ];

    if (!stoppableStates.includes(container.status as DockerContainerStatus)) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch("dockerContainers", args.containerId, {
      status: "stopping",
      statusChangedAt: now,
      statusHistory: [
        ...container.statusHistory,
        { status: "stopping", timestamp: now, reason: args.reason },
      ],
    });
  },
});

// Heartbeat (called by frontend every 30s)
export const heartbeat = mutation({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container || container.userId !== userId) return;

    const now = Date.now();
    const updates: Partial<Doc<"dockerContainers">> = {
      lastHeartbeatAt: now,
    };

    if (container.status === "ready") {
      updates.status = "active";
      updates.statusChangedAt = now;
      updates.statusHistory = [
        ...container.statusHistory,
        { status: "active", timestamp: now, reason: "heartbeat_received" },
      ];
    }

    await ctx.db.patch("dockerContainers", args.containerId, updates);
  },
});

// ====================
// INTERNAL MUTATIONS
// ====================

// Increment retry count (stays in creating state for auto-retry)
export const incrementRetryCount = internalMutation({
  args: {
    containerId: v.id("dockerContainers"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) return;

    const now = Date.now();
    await ctx.db.patch("dockerContainers", args.containerId, {
      retryCount: container.retryCount + 1,
      errorMessage: args.errorMessage,
      statusHistory: [
        ...container.statusHistory,
        {
          status: container.status,
          timestamp: now,
          reason: `auto_retry_${container.retryCount + 1}: ${args.errorMessage.slice(0, 100)}`,
        },
      ],
    });
  },
});

// Update status (with history tracking and state machine validation)
export const updateStatus = internalMutation({
  args: {
    containerId: v.id("dockerContainers"),
    status: containerStatusValidator,
    updates: v.optional(
      v.object({
        containerId: v.optional(v.string()),
        hostPort: v.optional(v.number()),
        previewUrl: v.optional(v.string()),
        logsUrl: v.optional(v.string()),
        terminalUrl: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        destroyedAt: v.optional(v.number()),
      })
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const container = await ctx.db.get("dockerContainers", args.containerId);
    if (!container) {
      console.error(`[updateStatus] Container ${args.containerId} not found`);
      return { success: false, error: "Container not found" };
    }

    const currentStatus = container.status as DockerContainerStatus;
    const newStatus = args.status as DockerContainerStatus;

    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      console.warn(
        `[updateStatus] Invalid transition: ${currentStatus} -> ${newStatus} for container ${args.containerId}`
      );
      return {
        success: false,
        error: `Invalid transition from ${currentStatus} to ${newStatus}`,
      };
    }

    const now = Date.now();
    const update: Partial<Doc<"dockerContainers">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...container.statusHistory,
        { status: newStatus, timestamp: now, reason: args.reason },
      ],
    };

    if (args.updates) {
      if (args.updates.containerId !== undefined) update.containerId = args.updates.containerId;
      if (args.updates.hostPort !== undefined) update.hostPort = args.updates.hostPort;
      if (args.updates.previewUrl !== undefined) update.previewUrl = args.updates.previewUrl;
      if (args.updates.logsUrl !== undefined) update.logsUrl = args.updates.logsUrl;
      if (args.updates.terminalUrl !== undefined) update.terminalUrl = args.updates.terminalUrl;
      if (args.updates.errorMessage !== undefined) update.errorMessage = args.updates.errorMessage;
      if (args.updates.destroyedAt !== undefined) update.destroyedAt = args.updates.destroyedAt;
    }

    if (newStatus === "destroyed" && !update.destroyedAt) {
      update.destroyedAt = now;
    }

    await ctx.db.patch("dockerContainers", args.containerId, update);

    console.log(
      `[updateStatus] Container ${args.containerId}: ${currentStatus} -> ${newStatus} (${args.reason || "no reason"})`
    );
    return { success: true };
  },
});

// Progress ordering for setup phases (higher = further along)
const PHASE_ORDER: Record<string, number> = {
  requested: 0,
  creating: 1,
  cloning: 2,
  installing: 3,
  starting: 4,
  ready: 5,
  active: 6,
  stopping: 7,
  destroying: 8,
  destroyed: 9,
  unhealthy: -1, // special: always allowed
};

// Update status from host callback (validates apiSecret)
export const updateStatusFromHost = internalMutation({
  args: {
    containerName: v.string(),
    apiSecret: v.string(),
    status: v.union(
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("starting"),
      v.literal("ready"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    buildLog: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const containers = await ctx.db
      .query("dockerContainers")
      .withIndex("by_containerName", (q) => q.eq("containerName", args.containerName))
      .collect();

    if (containers.length === 0) {
      console.log(`[updateStatusFromHost] Container not found: ${args.containerName}`);
      return { success: false, error: "Container not found" };
    }

    const container = containers.find((c) => c.apiSecret === args.apiSecret);
    if (!container) {
      console.log(`[updateStatusFromHost] Secret mismatch for ${args.containerName}`);
      return { success: false, error: "Invalid secret" };
    }

    if (container.status === "destroyed") {
      return { success: true };
    }

    const now = Date.now();
    const currentStatus = container.status as DockerContainerStatus;

    let newStatus: DockerContainerStatus;
    if (args.status === "failed") {
      newStatus = "unhealthy";
    } else {
      newStatus = args.status;
    }

    // Idempotency: if already at this status, acknowledge without changing
    if (currentStatus === newStatus) {
      console.log(
        `[updateStatusFromHost] Container ${container._id}: already at ${currentStatus}, ignoring duplicate`
      );
      return { success: true };
    }

    // For non-failure callbacks, reject stale/backward transitions
    // This prevents out-of-order callbacks from corrupting state
    if (newStatus !== "unhealthy") {
      const currentOrder = PHASE_ORDER[currentStatus] ?? -1;
      const newOrder = PHASE_ORDER[newStatus] ?? -1;
      if (newOrder <= currentOrder) {
        console.log(
          `[updateStatusFromHost] Ignoring stale callback: ${currentStatus} (${currentOrder}) -> ${newStatus} (${newOrder}) for container ${container._id}`
        );
        return { success: true };
      }
    }

    // If container is already stopping/destroying, ignore setup callbacks
    if (currentStatus === "stopping" || currentStatus === "destroying") {
      console.log(
        `[updateStatusFromHost] Ignoring callback for ${currentStatus} container ${container._id}`
      );
      return { success: true };
    }

    const update: Partial<Doc<"dockerContainers">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...container.statusHistory,
        {
          status: newStatus,
          timestamp: now,
          reason: `host_report${args.errorMessage ? `: ${args.errorMessage}` : ""}`,
        },
      ],
    };

    if (args.errorMessage) {
      update.errorMessage = args.errorMessage;
    }

    if (args.buildLog) {
      update.buildLog = args.buildLog;
    }

    await ctx.db.patch("dockerContainers", container._id, update);
    console.log(
      `[updateStatusFromHost] Container ${container._id}: ${currentStatus} -> ${newStatus}`
    );
    return { success: true };
  },
});

// Detect transient Docker host errors worth retrying (EOF, network, 5xx)
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

// Backoff delay in ms: 2s, 4s, 8s
function retryBackoffMs(retryCount: number): number {
  return Math.min(2000 * Math.pow(2, retryCount), 8000);
}

// ====================
// ACTIONS
// ====================

// Create container on Docker host
export const createContainer = internalAction({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    console.log(`[createContainer] Starting for container ${args.containerId}`);

    const container = await ctx.runQuery(internal.dockerContainers.getByIdInternal, {
      containerId: args.containerId,
    });
    if (!container) {
      console.error(`[createContainer] Container ${args.containerId} not found`);
      return;
    }

    // If container was stopped/destroyed while we were queued, bail out
    if (container.status === "stopping" || container.status === "destroying" || container.status === "destroyed") {
      console.log(`[createContainer] Container ${args.containerId} is ${container.status}, aborting`);
      return;
    }

    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "DOCKER_API_SECRET not configured" },
        reason: "missing_config",
      });
      return;
    }

    // Get repo details, GitHub token, and team LLM config in parallel
    const [repo, githubTokenResult] = await Promise.all([
      ctx.runQuery(api.projects.get, { repoId: container.repoId }),
      getUserGithubTokenById(ctx, container.userId).catch((err: unknown) => {
        return { error: err instanceof Error ? err.message : "GitHub token error" } as const;
      }),
    ]);

    if (!repo) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    const team = await ctx.runQuery(internal.teams.getTeamInternal, { teamId: repo.teamId });
    const anthropicApiKey =
      (team?.llmProvider === "anthropic" && team?.llmApiKey) ? team.llmApiKey
      : process.env.CLAUDE_API_KEY || "";

    // Check GitHub token result
    if (typeof githubTokenResult === "object" && githubTokenResult && "error" in githubTokenResult) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: githubTokenResult.error },
        reason: "github_token_error",
      });
      return;
    }

    const githubToken = githubTokenResult as string | undefined;
    if (!githubToken) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "GitHub token not available" },
        reason: "no_github_token",
      });
      return;
    }

    // Verify the target branch exists before attempting to clone
    const targetBranch = container.branch || repo.defaultBranch;
    const { branch: resolvedBranch, fellBack } = await resolveContainerBranch(
      githubToken,
      repo.githubOwner,
      repo.githubRepo,
      targetBranch,
      repo.defaultBranch,
    );

    if (fellBack) {
      await ctx.runMutation(internal.dockerContainers.updateBranch, {
        containerId: args.containerId,
        branch: resolvedBranch,
        reason: `branch_fallback: "${targetBranch}" not found, using "${resolvedBranch}"`,
      });
    }

    // Check for a CRIU checkpoint (fastest path — restore pre-installed container)
    const checkpoint = await ctx.runQuery(internal.dockerCheckpoints.getCheckpoint, {
      repoId: container.repoId,
      branch: resolvedBranch,
    });

    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

    if (checkpoint) {
      console.log(`[createContainer] Found checkpoint ${checkpoint.checkpointName}, attempting restore`);
      const volumeName = `${repo.githubOwner}-${repo.githubRepo}-node_modules`;
      const restoreResult = await ctx.runAction(internal.dockerCheckpoints.restoreFromCheckpoint, {
        checkpointName: checkpoint.checkpointName,
        containerName: container.containerName,
        volumeName,
      });

      if (restoreResult.success) {
        const data = restoreResult.data;
        const dockerHostUrl = process.env.DOCKER_HOST_URL!;
        const dockerWsUrl = dockerHostUrl.replace(/^http/, "ws");

        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: args.containerId,
          status: "starting",
          updates: {
            containerId: data.id,
            hostPort: data.hostPort,
            previewUrl: `http://${process.env.DOCKER_HOST!}:${data.hostPort}`,
            logsUrl: `${dockerHostUrl}/api/containers/${data.id}/logs`,
            terminalUrl: `${dockerWsUrl}/api/containers/${data.id}/terminal`,
          },
          reason: "restored_from_checkpoint",
        });

        await ctx.runMutation(internal.dockerCheckpoints.recordCheckpointUsage, {
          checkpointId: checkpoint._id,
        });

        // Container is restored with deps installed — just start the dev server
        await ctx.scheduler.runAfter(0, internal.dockerContainers.startDevServer, {
          containerId: args.containerId,
        });
        return;
      }

      console.warn(`[createContainer] Checkpoint restore failed: ${restoreResult.error}, falling back to normal flow`);
    }

    // Check if a main image exists for this repo
    const repoImage = await ctx.runQuery(internal.dockerContainers.getRepoImage, {
      repoId: container.repoId,
    });

    const baseImage = repoImage?.imageTag || "node:24-slim-git";

    try {
      let imageToUse = baseImage;

      const createOnHost = async (image: string) => {
        return await fetch(`${hostUrl}/api/containers`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: container.containerName,
            image,
            ports: [3000],
            volumeName: `${repo.githubOwner}-${repo.githubRepo}-node_modules`,
          }),
        });
      };

      let response = await createOnHost(imageToUse);
      let cachedErrorText: string | undefined;

      if (!response.ok && repoImage) {
        cachedErrorText = await response.text();
        if (cachedErrorText.includes("no such image") || cachedErrorText.includes("No such image")) {
          console.warn(`[createContainer] Repo image ${imageToUse} not found on host, invalidating and falling back to default`);
          await ctx.runMutation(internal.dockerContainers.markRepoImageFailed, {
            repoId: container.repoId,
            branch: repoImage.branch,
            errorMessage: "Image not found on Docker host",
          });
          imageToUse = "node:24-slim-git";
          response = await createOnHost(imageToUse);
          cachedErrorText = undefined;
        }
      }

      // Handle 409 Conflict: container name already exists on the host.
      // This happens when retrying after a failed/unhealthy container that
      // wasn't cleaned up. Remove the stale container and retry once.
      if (response.status === 409) {
        const conflictText = cachedErrorText ?? await response.text();
        console.warn(`[createContainer] 409 conflict for ${container.containerName}, removing stale container and retrying`);
        cachedErrorText = undefined;

        const staleIdMatch = conflictText.match(/by container "([a-f0-9]+)"/);
        const staleId = staleIdMatch?.[1];
        if (staleId) {
          try {
            await fetch(`${hostUrl}/api/containers/${staleId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiSecret}` },
            });
          } catch (deleteErr) {
            console.warn(`[createContainer] Failed to remove stale container ${staleId}: ${deleteErr instanceof Error ? deleteErr.message : "unknown"}`);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        response = await createOnHost(imageToUse);
      }

      if (!response.ok) {
        const error = cachedErrorText ?? await response.text();
        console.error(`[createContainer] Host API error: ${error}`);

        // Auto-retry transient errors (EOF, network, 5xx) with backoff
        if (isTransientError(error, response.status) && container.retryCount < MAX_RETRIES - 1) {
          const delay = retryBackoffMs(container.retryCount);
          console.log(`[createContainer] Transient error, scheduling retry ${container.retryCount + 1}/${MAX_RETRIES} in ${delay}ms`);
          await ctx.runMutation(internal.dockerContainers.incrementRetryCount, {
            containerId: args.containerId,
            errorMessage: error,
          });
          await ctx.scheduler.runAfter(delay, internal.dockerContainers.createContainer, {
            containerId: args.containerId,
          });
          return;
        }

        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: args.containerId,
          status: "unhealthy",
          updates: {
            errorMessage: container.retryCount > 0
              ? `Failed to create container after ${container.retryCount + 1} attempts: ${error}`
              : `Failed to create container: ${error}`,
          },
          reason: container.retryCount > 0 ? "create_failed_max_retries" : "create_failed",
        });
        return;
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        hostPort: number;
      };

      const dockerHostUrl = process.env.DOCKER_HOST_URL!;
      const dockerWsUrl = dockerHostUrl.replace(/^http/, "ws");

      const statusResult = await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "cloning",
        updates: {
          containerId: data.id,
          hostPort: data.hostPort,
          previewUrl: `http://${process.env.DOCKER_HOST!}:${data.hostPort}`,
          logsUrl: `${dockerHostUrl}/api/containers/${data.id}/logs`,
          terminalUrl: `${dockerWsUrl}/api/containers/${data.id}/terminal`,
        },
        reason: "container_created",
      });

      if (!statusResult?.success) {
        console.error(`[createContainer] Failed to transition to cloning: ${statusResult?.error}. Cleaning up host container.`);
        try {
          await fetch(`${hostUrl}/api/containers/${data.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiSecret}` },
          });
        } catch {}
        return;
      }

      // Proceed directly to setup (eliminates scheduler roundtrip)
      console.log(`[createContainer] Container created, proceeding to setup inline`);

      const callbackUrl = process.env.CONVEX_SITE_URL + "/docker-status";

      const usedRepoImage = imageToUse !== "node:24-slim-git" && !!repoImage;
      const setupResponse = await fetch(`${hostUrl}/api/containers/${data.id}/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: `${repo.githubOwner}/${repo.githubRepo}`,
          branch: resolvedBranch,
          defaultBranch: repo.defaultBranch,
          githubToken,
          callbackUrl,
          callbackSecret: container.apiSecret,
          hasMainImage: usedRepoImage,
          buildMainImage: !usedRepoImage && (resolvedBranch === repo.defaultBranch || resolvedBranch === "main"),
          envVars: {
            ...(repo.envVars?.reduce((acc: Record<string, string>, { key, value }: { key: string; value: string }) => ({ ...acc, [key]: value }), {}) ?? {}),
            ...(repo.externalConvexUrl ? { NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl } : {}),
            ...(repo.externalConvexDeployment ? { CONVEX_DEPLOYMENT: repo.externalConvexDeployment } : {}),
            ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
          },
        }),
      });

      if (!setupResponse.ok) {
        const error = await setupResponse.text();
        console.error(`[createContainer] Setup failed: ${error}`);
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: args.containerId,
          status: "unhealthy",
          updates: { errorMessage: `Setup failed: ${error}` },
          reason: "setup_failed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[createContainer] Error: ${message}`);

      // Auto-retry transient network errors (fetch failures, etc.)
      if (isTransientError(message) && container.retryCount < MAX_RETRIES - 1) {
        const delay = retryBackoffMs(container.retryCount);
        console.log(`[createContainer] Transient error (catch), scheduling retry ${container.retryCount + 1}/${MAX_RETRIES} in ${delay}ms`);
        await ctx.runMutation(internal.dockerContainers.incrementRetryCount, {
          containerId: args.containerId,
          errorMessage: message,
        });
        await ctx.scheduler.runAfter(delay, internal.dockerContainers.createContainer, {
          containerId: args.containerId,
        });
        return;
      }

      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: `Create container error: ${message}` },
        reason: "create_error",
      });
    }
  },
});

// Start dev server on a restored container (post-checkpoint-restore path)
export const startDevServer = internalAction({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    console.log(`[startDevServer] Starting for container ${args.containerId}`);

    const container = await ctx.runQuery(internal.dockerContainers.getByIdInternal, {
      containerId: args.containerId,
    });
    if (!container || !container.containerId) {
      console.error(`[startDevServer] Container ${args.containerId} not found or no host container ID`);
      return;
    }

    const [repo, githubTokenResult] = await Promise.all([
      ctx.runQuery(api.projects.get, { repoId: container.repoId }),
      getUserGithubTokenById(ctx, container.userId).catch((err: unknown) => {
        return { error: err instanceof Error ? err.message : "GitHub token error" } as const;
      }),
    ]);

    if (!repo) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    const githubToken = (typeof githubTokenResult === "object" && githubTokenResult && "error" in githubTokenResult)
      ? undefined
      : githubTokenResult as string | undefined;

    const team = await ctx.runQuery(internal.teams.getTeamInternal, { teamId: repo.teamId });
    const anthropicApiKey =
      (team?.llmProvider === "anthropic" && team?.llmApiKey) ? team.llmApiKey
      : process.env.CLAUDE_API_KEY || "";

    const apiSecret = process.env.DOCKER_API_SECRET;
    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;
    const callbackUrl = process.env.CONVEX_SITE_URL + "/docker-status";

    try {
      const envVars: Record<string, string> = {
        ...(repo.envVars?.reduce((acc: Record<string, string>, { key, value }: { key: string; value: string }) => ({ ...acc, [key]: value }), {}) ?? {}),
        ...(repo.externalConvexUrl ? { NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl } : {}),
        ...(repo.externalConvexDeployment ? { CONVEX_DEPLOYMENT: repo.externalConvexDeployment } : {}),
        ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
      };

      const setupResponse = await fetch(`${hostUrl}/api/containers/${container.containerId}/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: `${repo.githubOwner}/${repo.githubRepo}`,
          branch: container.branch || repo.defaultBranch,
          defaultBranch: repo.defaultBranch,
          githubToken,
          callbackUrl,
          callbackSecret: container.apiSecret,
          hasMainImage: true,
          buildMainImage: false,
          envVars,
          restoredFromCheckpoint: true,
        }),
      });

      if (!setupResponse.ok) {
        const error = await setupResponse.text();
        console.error(`[startDevServer] Setup failed: ${error}`);
        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: args.containerId,
          status: "unhealthy",
          updates: { errorMessage: `Dev server start failed: ${error}` },
          reason: "dev_server_start_failed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[startDevServer] Error: ${message}`);
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: `Dev server start error: ${message}` },
        reason: "dev_server_error",
      });
    }
  },
});

// Setup container (clone repo and start dev server)
// Used by pool containers which already have a host container created
export const setupContainer = internalAction({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    console.log(`[setupContainer] Starting for container ${args.containerId}`);

    const container = await ctx.runQuery(internal.dockerContainers.getByIdInternal, {
      containerId: args.containerId,
    });
    if (!container || !container.containerId) {
      console.error(`[setupContainer] Container ${args.containerId} not found or no host container ID`);
      return;
    }

    const [repo, githubTokenResult] = await Promise.all([
      ctx.runQuery(api.projects.get, { repoId: container.repoId }),
      getUserGithubTokenById(ctx, container.userId).catch((err: unknown) => {
        return { error: err instanceof Error ? err.message : "GitHub token error" } as const;
      }),
    ]);

    if (!repo) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    const team = await ctx.runQuery(internal.teams.getTeamInternal, { teamId: repo.teamId });
    const anthropicApiKey =
      (team?.llmProvider === "anthropic" && team?.llmApiKey) ? team.llmApiKey
      : process.env.CLAUDE_API_KEY || "";

    if (typeof githubTokenResult === "object" && githubTokenResult && "error" in githubTokenResult) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: githubTokenResult.error },
        reason: "github_token_error",
      });
      return;
    }

    const githubToken = githubTokenResult as string | undefined;
    if (!githubToken) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "GitHub token not available" },
        reason: "no_github_token",
      });
      return;
    }

    const apiSecret = process.env.DOCKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: "DOCKER_API_SECRET not configured" },
        reason: "missing_config",
      });
      return;
    }

    // Verify the target branch exists before attempting to clone
    const targetBranch = container.branch || repo.defaultBranch;
    const { branch: resolvedBranch, fellBack } = await resolveContainerBranch(
      githubToken,
      repo.githubOwner,
      repo.githubRepo,
      targetBranch,
      repo.defaultBranch,
    );

    if (fellBack) {
      await ctx.runMutation(internal.dockerContainers.updateBranch, {
        containerId: args.containerId,
        branch: resolvedBranch,
        reason: `branch_fallback: "${targetBranch}" not found, using "${resolvedBranch}"`,
      });
    }

    const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;
    const callbackUrl = process.env.CONVEX_SITE_URL + "/docker-status";

    // Check if a main image exists for this repo
    const repoImage = await ctx.runQuery(internal.dockerContainers.getRepoImage, {
      repoId: container.repoId,
    });

    try {
      const response = await fetch(`${hostUrl}/api/containers/${container.containerId}/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: `${repo.githubOwner}/${repo.githubRepo}`,
          branch: resolvedBranch,
          defaultBranch: repo.defaultBranch,
          githubToken,
          callbackUrl,
          callbackSecret: container.apiSecret,
          hasMainImage: !!repoImage,
          buildMainImage: !repoImage && (resolvedBranch === repo.defaultBranch || resolvedBranch === "main"),
          envVars: {
            ...(repo.envVars?.reduce((acc: Record<string, string>, { key, value }: { key: string; value: string }) => ({ ...acc, [key]: value }), {}) ?? {}),
            ...(repo.externalConvexUrl ? { NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl } : {}),
            ...(repo.externalConvexDeployment ? { CONVEX_DEPLOYMENT: repo.externalConvexDeployment } : {}),
            ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[setupContainer] Setup failed: ${error}`);

        if (response.status === 404 || error.includes("Container not found")) {
          console.log(`[setupContainer] Container not found on host, falling back to createContainer`);
          const result = await ctx.runMutation(internal.dockerContainers.updateStatus, {
            containerId: args.containerId,
            status: "creating",
            updates: {
              containerId: undefined,
              hostPort: undefined,
              previewUrl: undefined,
              logsUrl: undefined,
              terminalUrl: undefined,
            },
            reason: "pool_container_not_found_fallback",
          });
          if (result?.success) {
            await ctx.scheduler.runAfter(0, internal.dockerContainers.createContainer, {
              containerId: args.containerId,
            });
          } else {
            console.error(`[setupContainer] Failed to transition to creating, aborting fallback: ${result?.error}`);
            await ctx.runMutation(internal.dockerContainers.updateStatus, {
              containerId: args.containerId,
              status: "unhealthy",
              updates: { errorMessage: "Setup failed: container not found on host and fallback failed" },
              reason: "fallback_transition_failed",
            });
          }
          return;
        }

        await ctx.runMutation(internal.dockerContainers.updateStatus, {
          containerId: args.containerId,
          status: "unhealthy",
          updates: { errorMessage: `Setup failed: ${error}` },
          reason: "setup_failed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[setupContainer] Error: ${message}`);
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "unhealthy",
        updates: { errorMessage: `Setup error: ${message}` },
        reason: "setup_error",
      });
    }
  },
});

// Destroy container on Docker host
export const destroyContainer = internalAction({
  args: { containerId: v.id("dockerContainers") },
  handler: async (ctx, args) => {
    console.log(`[destroyContainer] Starting for container ${args.containerId}`);

    const container = await ctx.runQuery(internal.dockerContainers.getByIdInternal, {
      containerId: args.containerId,
    });
    if (!container) {
      console.error(`[destroyContainer] Container ${args.containerId} not found`);
      return;
    }

    if (container.status !== "destroying") {
      await ctx.runMutation(internal.dockerContainers.updateStatus, {
        containerId: args.containerId,
        status: "destroying",
        reason: "destroy_started",
      });
    }

    if (container.containerId) {
      const apiSecret = process.env.DOCKER_API_SECRET;
      const hostUrl = process.env.DOCKER_HOST_URL || DOCKER_HOST;

      try {
        console.log(`[destroyContainer] Deleting container ${container.containerId} from host`);
        const response = await fetch(`${hostUrl}/api/containers/${container.containerId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.error(`[destroyContainer] Failed to delete: ${await response.text()}`);
        } else {
          console.log(`[destroyContainer] Container ${container.containerId} deleted from host`);
        }
      } catch (err) {
        console.error(
          `[destroyContainer] Error deleting container: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    await ctx.runMutation(internal.dockerContainers.updateStatus, {
      containerId: args.containerId,
      status: "destroyed",
      updates: { destroyedAt: Date.now() },
      reason: "container_destroyed",
    });
  },
});

// ====================
// REPO IMAGE FUNCTIONS
// ====================

// Get repo image for a repo (main branch)
export const getRepoImage = internalQuery({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dockerRepoImages")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .filter((q) => q.eq(q.field("status"), "ready"))
      .first();
  },
});

// Record repo image creation from host callback
export const recordRepoImage = internalMutation({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    imageTag: v.string(),
    commitSha: v.string(),
    sizeBytes: v.optional(v.number()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("dockerRepoImages")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .first();

    if (existing) {
      await ctx.db.patch("dockerRepoImages", existing._id, {
        imageTag: args.imageTag,
        commitSha: args.commitSha,
        sizeBytes: args.sizeBytes,
        createdAt: now,
        createdBy: args.createdBy,
        status: "ready",
        errorMessage: undefined,
      });
      console.log(
        `[recordRepoImage] Updated image for repo ${args.repoId} branch ${args.branch}`
      );
      return existing._id;
    }

    const imageId = await ctx.db.insert("dockerRepoImages", {
      repoId: args.repoId,
      branch: args.branch,
      imageTag: args.imageTag,
      commitSha: args.commitSha,
      sizeBytes: args.sizeBytes,
      status: "ready",
      createdAt: now,
      createdBy: args.createdBy,
      useCount: 0,
    });

    console.log(
      `[recordRepoImage] Created image ${imageId} for repo ${args.repoId} branch ${args.branch}`
    );
    return imageId;
  },
});

// Record repo image usage (for analytics)
export const recordRepoImageUsage = internalMutation({
  args: {
    imageId: v.id("dockerRepoImages"),
  },
  handler: async (ctx, args) => {
    const image = await ctx.db.get("dockerRepoImages", args.imageId);
    if (!image) return;

    await ctx.db.patch("dockerRepoImages", args.imageId, {
      lastUsedAt: Date.now(),
      useCount: (image.useCount || 0) + 1,
    });
  },
});

// Mark repo image as failed
export const markRepoImageFailed = internalMutation({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dockerRepoImages")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .first();

    if (existing) {
      await ctx.db.patch("dockerRepoImages", existing._id, {
        status: "failed",
        errorMessage: args.errorMessage,
      });
    }
  },
});
