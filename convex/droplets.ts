import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
  action,
  ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "./_generated/dataModel";
import { internal, api } from "./_generated/api";

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
    console.error("[refreshGithubToken] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET");
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

    if (data.error) {
      console.error("[refreshGithubToken] GitHub error:", data.error, data.error_description);
      return null;
    }

    if (!data.access_token) {
      console.error("[refreshGithubToken] No access_token in response");
      return null;
    }

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: expiresAt ?? Date.now() + 8 * 60 * 60 * 1000,
    };
  } catch (err) {
    console.error("[refreshGithubToken] Failed to refresh token:", err);
    return null;
  }
}

/**
 * Get a user's GitHub token by user ID, refreshing if expired.
 * Throws an error if token refresh fails.
 */
async function getUserGithubTokenById(
  ctx: ActionCtx,
  userId: string,
): Promise<string | undefined> {
  const profile = await ctx.runQuery(internal.users.getProfileById, { userId });

  if (!profile?.githubAccessToken) {
    return undefined;
  }

  const expiresAt = profile.githubTokenExpiresAt;
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    console.log("[getUserGithubTokenById] Token expired or expiring soon, attempting refresh");

    if (!profile.githubRefreshToken) {
      throw new Error(
        "GitHub connection has expired. User needs to reconnect their GitHub account in Settings.",
      );
    }

    const newTokens = await refreshGithubToken(profile.githubRefreshToken);

    if (!newTokens) {
      await ctx.runMutation(internal.users.disconnectGithubById, { userId });
      throw new Error(
        "GitHub connection has expired and could not be refreshed. User needs to reconnect their GitHub account in Settings.",
      );
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

// Status type for type safety
export type DropletStatus =
  | "requested"
  | "creating"
  | "create_failed"
  | "provisioning"
  | "booting"
  | "cloning"
  | "installing"
  | "ready"
  | "active"
  | "stopping"
  | "destroying"
  | "destroyed"
  | "unhealthy";

// Status validator for Convex
const dropletStatusValidator = v.union(
  v.literal("requested"),
  v.literal("creating"),
  v.literal("create_failed"),
  v.literal("provisioning"),
  v.literal("booting"),
  v.literal("cloning"),
  v.literal("installing"),
  v.literal("ready"),
  v.literal("active"),
  v.literal("stopping"),
  v.literal("destroying"),
  v.literal("destroyed"),
  v.literal("unhealthy")
);

// Valid state transitions (state machine rules)
const VALID_TRANSITIONS: Record<DropletStatus, DropletStatus[]> = {
  requested: ["creating", "unhealthy"],
  creating: ["provisioning", "create_failed", "unhealthy"],
  create_failed: ["creating", "unhealthy"],
  provisioning: ["booting", "unhealthy"],
  booting: ["cloning", "unhealthy"],
  cloning: ["installing", "unhealthy"],
  installing: ["ready", "unhealthy"],
  ready: ["active", "stopping", "unhealthy"],
  active: ["ready", "stopping", "unhealthy"],
  stopping: ["destroying"],
  destroying: ["destroyed", "unhealthy"],
  destroyed: [],
  unhealthy: ["destroying"],
};

// Timeout thresholds (in milliseconds)
export const TIMEOUTS = {
  creating: 5 * 60 * 1000, // 5 minutes
  provisioning: 10 * 60 * 1000, // 10 minutes
  booting: 5 * 60 * 1000, // 5 minutes
  cloning: 10 * 60 * 1000, // 10 minutes
  installing: 15 * 60 * 1000, // 15 minutes
  heartbeat_warning: 60 * 1000, // 1 minute (active -> ready)
  heartbeat_stop: 5 * 60 * 1000, // 5 minutes (ready -> stopping)
};

// Helper to check if a droplet appears stuck (timed out in a transitional state)
function isDropletStuck(droplet: {
  status: string;
  statusChangedAt: number;
}): boolean {
  const now = Date.now();
  const elapsed = now - droplet.statusChangedAt;

  switch (droplet.status) {
    case "requested":
    case "creating":
      return elapsed > TIMEOUTS.creating;
    case "provisioning":
      return elapsed > TIMEOUTS.provisioning;
    case "booting":
      return elapsed > TIMEOUTS.booting;
    case "cloning":
      return elapsed > TIMEOUTS.cloning;
    case "installing":
      return elapsed > TIMEOUTS.installing;
    default:
      return false;
  }
}

// Max retries for creation failures
const MAX_RETRIES = 3;

// Retry delays (exponential backoff in milliseconds)
const RETRY_DELAYS = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

// Default quota per team
const DEFAULT_MAX_DROPLETS = 5;

// Default droplet configuration
// Note: process.env is NOT available at module load time in Convex, only in Actions.
// These constants are used for database records; the actual env vars are read in createDroplet action.
const DEFAULT_REGION = "nyc1";
const DEFAULT_SIZE = "s-2vcpu-2gb";

// Generate a unique droplet name
function generateDropletName(repoName: string, sessionId: string): string {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const suffix = sessionId.slice(-8);
  return `artie-${sanitized}-${suffix}`;
}

// Generate a cryptographically secure API secret
function generateApiSecret(): string {
  // Use crypto.randomUUID() for better randomness than Math.random()
  // Concatenate two UUIDs and remove dashes for a 64-char string
  const uuid1 = crypto.randomUUID().replace(/-/g, "");
  const uuid2 = crypto.randomUUID().replace(/-/g, "");
  return (uuid1 + uuid2).slice(0, 64);
}

// ====================
// QUERIES
// ====================

// Get droplet by session ID
export const getBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const droplet = await ctx.db
      .query("droplets")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    // Don't return destroyed droplets
    if (droplet?.status === "destroyed") return null;

    return droplet;
  },
});

// Get droplet for preview - checks session first, then repo+branch
// This allows multiple sessions to share a droplet on the same branch
export const getForPreview = query({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // First check for a droplet associated with this session
    const dropletBySession = await ctx.db
      .query("droplets")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (dropletBySession && dropletBySession.status !== "destroyed") {
      return dropletBySession;
    }

    // If no session droplet, check for droplets on the same repo+branch
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const dropletsForBranch = await ctx.db
      .query("droplets")
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

    // Filter out stuck droplets
    const healthyDroplets = dropletsForBranch.filter((d) => !isDropletStuck(d));

    if (healthyDroplets.length === 0) return null;

    // Prefer ready/active droplets over ones still booting
    const readyDroplet = healthyDroplets.find(
      (d) => d.status === "ready" || d.status === "active"
    );
    if (readyDroplet) return readyDroplet;

    // Otherwise return the most recently created one
    return healthyDroplets.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

// Get droplet by ID (for actions)
export const getById = query({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    return await ctx.db.get("droplets", args.dropletId);
  },
});

// Internal query to get droplet by ID (for internal use)
export const getByIdInternal = internalQuery({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    return await ctx.db.get("droplets", args.dropletId);
  },
});

// Get droplet by droplet name
export const getByDropletName = query({
  args: { dropletName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("droplets")
      .withIndex("by_dropletName", (q) => q.eq("dropletName", args.dropletName))
      .first();
  },
});

// Internal query to get droplet by name
export const getByDropletNameInternal = internalQuery({
  args: { dropletName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("droplets")
      .withIndex("by_dropletName", (q) => q.eq("dropletName", args.dropletName))
      .first();
  },
});

// Get team's current droplet quota
export const getQuota = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const quota = await ctx.db
      .query("dropletQuotas")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .first();

    if (!quota) {
      // Return default quota if none exists
      return {
        maxDroplets: DEFAULT_MAX_DROPLETS,
        currentActive: 0,
      };
    }

    return {
      maxDroplets: quota.maxDroplets,
      currentActive: quota.currentActive,
    };
  },
});

// Debug: List recent droplets (internal use only)
export const listRecentForDebug = internalQuery({
  handler: async (ctx) => {
    const droplets = await ctx.db
      .query("droplets")
      .order("desc")
      .take(10);
    
    return droplets.map(d => ({
      _id: d._id,
      dropletName: d.dropletName,
      status: d.status,
      statusChangedAt: d.statusChangedAt,
      createdAt: d.createdAt,
      errorMessage: d.errorMessage,
      ipv4Address: d.ipv4Address,
      previewUrl: d.previewUrl,
      apiUrl: d.apiUrl,
      apiSecretPrefix: d.apiSecret?.slice(0, 16),
      statusHistory: d.statusHistory.slice(-5), // Last 5 status changes
    }));
  },
});

// List droplets by repo
export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("droplets")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .filter((q) => q.neq(q.field("status"), "destroyed"))
      .collect();
  },
});

// ====================
// MUTATIONS
// ====================

// Request a new droplet (called by frontend)
export const request = mutation({
  args: {
    sessionId: v.id("sessions"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get session and verify access
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    const repo = await ctx.db.get("repos", session.repoId);
    if (!repo) throw new Error("Repository not found");

    const team = await ctx.db.get("teams", repo.teamId);
    if (!team) throw new Error("Team not found");

    // Check if user is a team member
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", repo.teamId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new Error("Not a team member");

    const targetBranch = args.branch ?? repo.defaultBranch;

    // Check for existing droplet for this session
    const existingForSession = await ctx.db
      .query("droplets")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existingForSession) {
      // If destroyed, we can create a new one
      if (existingForSession.status === "destroyed") {
        // Continue to create new
      }
      // If unhealthy, allow retry
      else if (existingForSession.status === "unhealthy") {
        const now = Date.now();
        await ctx.db.patch("droplets", existingForSession._id, {
          status: "requested",
          statusChangedAt: now,
          errorMessage: undefined,
          retryCount: 0,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "requested", timestamp: now, reason: "user_retry" },
          ],
        });
        return existingForSession._id;
      }
      // Otherwise return existing
      else {
        return existingForSession._id;
      }
    }

    // Check for an existing active droplet on the same repo+branch
    // This allows multiple sessions to share a single droplet instance
    const dropletsForBranch = await ctx.db
      .query("droplets")
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

    // Filter out stuck droplets - they've timed out and should be ignored
    const healthyDroplets = dropletsForBranch.filter((d) => !isDropletStuck(d));

    // Prefer ready/active droplets over ones still booting
    const readyDroplet = healthyDroplets.find(
      (d) => d.status === "ready" || d.status === "active"
    );
    if (readyDroplet) {
      return readyDroplet._id;
    }

    // If there's a healthy droplet in progress (creating, provisioning, etc.), use that
    const inProgressDroplet = healthyDroplets.sort(
      (a, b) => b.createdAt - a.createdAt
    )[0];
    if (inProgressDroplet) {
      return inProgressDroplet._id;
    }

    // Check quota
    let quota = await ctx.db
      .query("dropletQuotas")
      .withIndex("by_teamId", (q) => q.eq("teamId", repo.teamId))
      .first();

    if (!quota) {
      // Create default quota
      const quotaId = await ctx.db.insert("dropletQuotas", {
        teamId: repo.teamId,
        maxDroplets: DEFAULT_MAX_DROPLETS,
        currentActive: 0,
        lastUpdatedAt: Date.now(),
      });
      quota = (await ctx.db.get("dropletQuotas", quotaId))!;
    }

    // Count active droplets for the team
    const activeDroplets = await ctx.db
      .query("droplets")
      .withIndex("by_teamId", (q) => q.eq("teamId", repo.teamId))
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "destroyed"),
          q.neq(q.field("status"), "destroying"),
          q.neq(q.field("status"), "stopping")
        )
      )
      .collect();

    if (activeDroplets.length >= quota.maxDroplets) {
      throw new Error(
        `Team has reached the maximum of ${quota.maxDroplets} active droplets. Please stop an existing droplet first.`
      );
    }

    // Create new droplet record
    const now = Date.now();
    const dropletName = generateDropletName(repo.githubRepo, args.sessionId);
    const apiSecret = generateApiSecret();

    const dropletId = await ctx.db.insert("droplets", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      teamId: repo.teamId,
      userId,
      dropletName,
      region: DEFAULT_REGION,
      size: DEFAULT_SIZE,
      status: "requested",
      apiSecret,
      retryCount: 0,
      createdAt: now,
      statusChangedAt: now,
      statusHistory: [
        { status: "requested", timestamp: now, reason: "user_request" },
      ],
      branch: targetBranch,
    });

    // Update quota
    await ctx.db.patch("dropletQuotas", quota._id, {
      currentActive: activeDroplets.length + 1,
      lastUpdatedAt: now,
    });

    return dropletId;
  },
});

// Record heartbeat (called by frontend every 30s)
export const heartbeat = mutation({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const droplet = await ctx.db.get("droplets", args.dropletId);
    if (!droplet) return;

    // Only allow heartbeat from the owner
    if (droplet.userId !== userId) return;

    const now = Date.now();
    const updates: Partial<Doc<"droplets">> = {
      lastHeartbeatAt: now,
    };

    // If status is "ready", transition to "active"
    if (droplet.status === "ready") {
      updates.status = "active";
      updates.statusChangedAt = now;
      updates.statusHistory = [
        ...droplet.statusHistory,
        { status: "active", timestamp: now, reason: "heartbeat_received" },
      ];
    }

    await ctx.db.patch("droplets", args.dropletId, updates);
  },
});

// Request stop (called by frontend or cleanup scheduler)
export const requestStop = mutation({
  args: {
    dropletId: v.id("droplets"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const droplet = await ctx.db.get("droplets", args.dropletId);
    if (!droplet) throw new Error("Droplet not found");

    // Only allow owner to stop
    if (droplet.userId !== userId) throw new Error("Not authorized");

    // Only stop if in a stoppable state
    const stoppableStates: DropletStatus[] = [
      "ready",
      "active",
      "cloning",
      "installing",
      "booting",
      "provisioning",
      "creating",
      "create_failed",
      "requested",
      "unhealthy",
    ];

    if (!stoppableStates.includes(droplet.status as DropletStatus)) {
      return; // Already stopping or destroyed
    }

    const now = Date.now();
    await ctx.db.patch("droplets", args.dropletId, {
      status: "stopping",
      statusChangedAt: now,
      statusHistory: [
        ...droplet.statusHistory,
        { status: "stopping", timestamp: now, reason: args.reason },
      ],
    });
  },
});

// ====================
// INTERNAL MUTATIONS
// ====================

// Internal: Update status (with history tracking and state machine validation)
export const updateStatus = internalMutation({
  args: {
    dropletId: v.id("droplets"),
    status: dropletStatusValidator,
    updates: v.optional(
      v.object({
        dropletId: v.optional(v.string()),
        ipv4Address: v.optional(v.string()),
        previewUrl: v.optional(v.string()),
        apiUrl: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        lastHealthCheckAt: v.optional(v.number()),
        destroyedAt: v.optional(v.number()),
      })
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const droplet = await ctx.db.get("droplets", args.dropletId);
    if (!droplet) {
      console.error(`[updateStatus] Droplet ${args.dropletId} not found`);
      return { success: false, error: "Droplet not found" };
    }

    const currentStatus = droplet.status as DropletStatus;
    const newStatus = args.status as DropletStatus;

    // Validate state transition
    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      console.warn(
        `[updateStatus] Invalid transition: ${currentStatus} -> ${newStatus} for droplet ${args.dropletId}`
      );
      return {
        success: false,
        error: `Invalid transition from ${currentStatus} to ${newStatus}`,
      };
    }

    const now = Date.now();
    const update: Partial<Doc<"droplets">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...droplet.statusHistory,
        {
          status: newStatus,
          timestamp: now,
          reason: args.reason,
        },
      ],
    };

    // Apply additional updates
    if (args.updates) {
      if (args.updates.dropletId !== undefined) {
        update.dropletId = args.updates.dropletId;
      }
      if (args.updates.ipv4Address !== undefined) {
        update.ipv4Address = args.updates.ipv4Address;
      }
      if (args.updates.previewUrl !== undefined) {
        update.previewUrl = args.updates.previewUrl;
      }
      if (args.updates.apiUrl !== undefined) {
        update.apiUrl = args.updates.apiUrl;
      }
      if (args.updates.errorMessage !== undefined) {
        update.errorMessage = args.updates.errorMessage;
      }
      if (args.updates.lastHealthCheckAt !== undefined) {
        update.lastHealthCheckAt = args.updates.lastHealthCheckAt;
      }
      if (args.updates.destroyedAt !== undefined) {
        update.destroyedAt = args.updates.destroyedAt;
      }
    }

    // If transitioning to destroyed, set destroyedAt
    if (newStatus === "destroyed" && !update.destroyedAt) {
      update.destroyedAt = now;
    }

    await ctx.db.patch("droplets", args.dropletId, update);

    // Update quota if status changed to/from active states
    const activeStates: DropletStatus[] = [
      "requested",
      "creating",
      "create_failed",
      "provisioning",
      "booting",
      "cloning",
      "installing",
      "ready",
      "active",
    ];
    const wasActive = activeStates.includes(currentStatus);
    const isActive = activeStates.includes(newStatus);

    if (wasActive !== isActive) {
      const quota = await ctx.db
        .query("dropletQuotas")
        .withIndex("by_teamId", (q) => q.eq("teamId", droplet.teamId))
        .first();

      if (quota) {
        const activeDroplets = await ctx.db
          .query("droplets")
          .withIndex("by_teamId", (q) => q.eq("teamId", droplet.teamId))
          .filter((q) =>
            q.and(
              q.neq(q.field("status"), "destroyed"),
              q.neq(q.field("status"), "destroying"),
              q.neq(q.field("status"), "stopping"),
              q.neq(q.field("status"), "unhealthy")
            )
          )
          .collect();

        await ctx.db.patch("dropletQuotas", quota._id, {
          currentActive: activeDroplets.length,
          lastUpdatedAt: now,
        });
      }
    }

    console.log(
      `[updateStatus] Droplet ${args.dropletId}: ${currentStatus} -> ${newStatus} (${args.reason || "no reason"})`
    );
    return { success: true };
  },
});

// Internal: Mark creation as failed (with retry tracking)
export const markCreateFailed = internalMutation({
  args: {
    dropletId: v.id("droplets"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const droplet = await ctx.db.get("droplets", args.dropletId);
    if (!droplet) return;

    const now = Date.now();
    const newRetryCount = droplet.retryCount + 1;

    if (newRetryCount >= MAX_RETRIES) {
      // Max retries reached, mark as unhealthy
      await ctx.db.patch("droplets", args.dropletId, {
        status: "unhealthy",
        statusChangedAt: now,
        errorMessage: `Creation failed after ${MAX_RETRIES} attempts: ${args.errorMessage}`,
        retryCount: newRetryCount,
        lastRetryAt: now,
        statusHistory: [
          ...droplet.statusHistory,
          {
            status: "unhealthy",
            timestamp: now,
            reason: `max_retries_exceeded: ${args.errorMessage}`,
          },
        ],
      });
    } else {
      // Mark as create_failed for retry
      await ctx.db.patch("droplets", args.dropletId, {
        status: "create_failed",
        statusChangedAt: now,
        errorMessage: args.errorMessage,
        retryCount: newRetryCount,
        lastRetryAt: now,
        statusHistory: [
          ...droplet.statusHistory,
          {
            status: "create_failed",
            timestamp: now,
            reason: `attempt_${newRetryCount}_failed: ${args.errorMessage}`,
          },
        ],
      });
    }
  },
});

// Internal: Update status from container report (via HTTP endpoint)
export const updateStatusFromContainer = internalMutation({
  args: {
    dropletName: v.string(),
    apiSecret: v.string(),
    status: v.union(
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    // Find droplet by name - get ALL matching records and find the right one
    // (Multiple records can have the same name if droplets were recreated)
    const droplets = await ctx.db
      .query("droplets")
      .withIndex("by_dropletName", (q) => q.eq("dropletName", args.dropletName))
      .collect();

    if (droplets.length === 0) {
      console.log(`[updateStatusFromContainer] Droplet not found: ${args.dropletName}`);
      return { success: false, error: "Droplet not found" };
    }

    // Find the droplet with matching secret (there might be multiple with same name)
    const droplet = droplets.find(d => d.apiSecret === args.apiSecret);
    
    if (!droplet) {
      // Log what we found for debugging
      console.log(`[updateStatusFromContainer] Secret mismatch for ${args.dropletName}. Found ${droplets.length} records with secrets: ${droplets.map(d => d.apiSecret?.slice(0, 8) + '...').join(', ')}. Received: ${args.apiSecret?.slice(0, 8)}...`);
      return { success: false, error: "Invalid secret" };
    }
    
    // Skip if droplet is already destroyed
    if (droplet.status === "destroyed") {
      console.log(`[updateStatusFromContainer] Droplet ${args.dropletName} is already destroyed, ignoring status update`);
      return { success: true }; // Return success to stop the container from retrying
    }

    const now = Date.now();
    const currentStatus = droplet.status as DropletStatus;

    // Map container status to droplet status
    let newStatus: DropletStatus;
    if (args.status === "failed") {
      newStatus = "unhealthy";
    } else {
      newStatus = args.status;
    }

    // Validate transition
    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      // Allow the transition anyway for container reports (they know their state)
      console.warn(
        `[updateStatusFromContainer] Allowing irregular transition: ${currentStatus} -> ${newStatus}`
      );
    }

    const update: Partial<Doc<"droplets">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...droplet.statusHistory,
        {
          status: newStatus,
          timestamp: now,
          reason: `container_report${args.errorMessage ? `: ${args.errorMessage}` : ""}`,
        },
      ],
    };

    if (args.errorMessage) {
      update.errorMessage = args.errorMessage;
    }

    await ctx.db.patch("droplets", droplet._id, update);
    console.log(
      `[updateStatusFromContainer] Droplet ${droplet._id}: ${currentStatus} -> ${newStatus}`
    );
    return { success: true };
  },
});

// Internal: Get droplets by status for scheduler
export const getByStatus = internalQuery({
  args: {
    status: dropletStatusValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("droplets")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("asc");

    if (args.limit) {
      return await query.take(args.limit);
    }
    return await query.collect();
  },
});

// Internal: Get droplets that have been in a status too long
export const getTimedOutDroplets = internalQuery({
  args: {
    status: dropletStatusValidator,
    olderThan: v.number(), // timestamp
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("droplets")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", args.status).lt("statusChangedAt", args.olderThan)
      )
      .collect();
  },
});

// Internal: Get all droplets with DO droplet IDs (for reconciliation)
export const getAllWithDropletIds = internalQuery({
  handler: async (ctx) => {
    return await ctx.db
      .query("droplets")
      .filter((q) =>
        q.and(
          q.neq(q.field("dropletId"), undefined),
          q.neq(q.field("status"), "destroyed")
        )
      )
      .collect();
  },
});

// Internal: Delete old destroyed records
export const deleteOldDestroyed = internalMutation({
  args: {
    olderThan: v.number(), // timestamp
  },
  handler: async (ctx, args) => {
    const oldRecords = await ctx.db
      .query("droplets")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", "destroyed").lt("statusChangedAt", args.olderThan)
      )
      .collect();

    for (const record of oldRecords) {
      await ctx.db.delete("droplets", record._id);
    }

    return { deleted: oldRecords.length };
  },
});

// Internal: Check if retry is allowed based on exponential backoff
export const shouldRetryCreation = internalQuery({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    const droplet = await ctx.db.get("droplets", args.dropletId);
    if (!droplet) return false;

    if (droplet.status !== "create_failed") return false;
    if (droplet.retryCount >= MAX_RETRIES) return false;

    const delay = RETRY_DELAYS[Math.min(droplet.retryCount, RETRY_DELAYS.length - 1)];
    const nextRetryAt = (droplet.lastRetryAt || droplet.createdAt) + delay;

    return Date.now() >= nextRetryAt;
  },
});

// ====================
// DIGITALOCEAN API ACTIONS
// ====================

// DigitalOcean API base URL
const DO_API_BASE = "https://api.digitalocean.com/v2";

// Helper to make DO API requests with retry logic
async function doApiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  retries = 3
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const token = process.env.DIGITALOCEAN_TOKEN;
  if (!token) {
    return { ok: false, status: 0, error: "DIGITALOCEAN_TOKEN not configured" };
  }

  const url = `${DO_API_BASE}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...options.headers,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers });

      if (response.ok) {
        const data = response.status === 204 ? undefined : await response.json();
        return { ok: true, status: response.status, data };
      }

      // Don't retry client errors (4xx) except rate limiting (429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text();
        return { ok: false, status: response.status, error: errorText };
      }

      // Retry server errors (5xx) and rate limiting
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      const errorText = await response.text();
      return { ok: false, status: response.status, error: errorText };
    } catch (error) {
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  return { ok: false, status: 0, error: "Max retries exceeded" };
}

// Generate cloud-init user data for droplet
function generateUserData(params: {
  githubRepo: string;
  githubBranch: string;
  githubToken: string;
  apiSecret: string;
  dropletName: string;
  convexSiteUrl: string;
  externalConvexUrl?: string;
}): string {
  // Cloud-init script that sets up Node.js and runs the sprite server directly
  return `#!/bin/bash
set -e

exec > /var/log/cloud-init-script.log 2>&1

echo "=== Starting Artie Droplet Setup ==="

# Environment variables
export GITHUB_REPO="${params.githubRepo}"
export GITHUB_BRANCH="${params.githubBranch}"
export GITHUB_TOKEN="${params.githubToken}"
export API_SECRET="${params.apiSecret}"
export DROPLET_NAME="${params.dropletName}"
export CONVEX_SITE_URL="${params.convexSiteUrl}"
export API_PORT="3001"
export PROJECT_DIR="/app/project"
${params.externalConvexUrl ? `export NEXT_PUBLIC_CONVEX_URL="${params.externalConvexUrl}"` : ""}

# Node.js is pre-installed on this image
# Kill default PM2 app that uses port 3000, open firewall
echo "Stopping default PM2 node app..."
systemctl disable --now pm2-nodejs.service 2>/dev/null || true
pkill -9 -f '/var/www' 2>/dev/null || true

echo "Opening firewall ports..."
ufw allow 3000:3002/tcp 2>/dev/null || true

# Create 4GB swap file for better memory handling
echo "Creating swap space..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap created and enabled"
else
  echo "Swap already exists"
fi

echo "Installing pnpm..."
npm install -g pnpm
apt-get update && apt-get install -y git

# Create directories
mkdir -p /app/sprite-server /app/project /var/log

# Write environment to file for persistence
cat > /app/.env << 'ENVEOF'
GITHUB_REPO="${params.githubRepo}"
GITHUB_BRANCH="${params.githubBranch}"
GITHUB_TOKEN="${params.githubToken}"
API_SECRET="${params.apiSecret}"
DROPLET_NAME="${params.dropletName}"
CONVEX_SITE_URL="${params.convexSiteUrl}"
API_PORT="3001"
PROJECT_DIR="/app/project"
${params.externalConvexUrl ? `NEXT_PUBLIC_CONVEX_URL="${params.externalConvexUrl}"` : ""}
ENVEOF

# Create the API server
cat > /app/sprite-server/package.json << 'PKGEOF'
{
  "name": "sprite-server",
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "glob": "^10.3.10"
  }
}
PKGEOF

cat > /app/sprite-server/server.js << 'SERVEREOF'
import express from "express";
import { spawn } from "child_process";
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import { glob } from "glob";

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.API_PORT || 3001;
const API_SECRET = process.env.API_SECRET;
const PROJECT_DIR = process.env.PROJECT_DIR || "/app/project";

const IGNORE_PATTERNS = [
  "**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
  "**/.next/**", "**/.nuxt/**", "**/coverage/**", "**/.turbo/**",
  "**/*.log", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
];

function authenticate(req, res, next) {
  if (!API_SECRET) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== \`Bearer \${API_SECRET}\`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use(authenticate);

app.get("/health", (req, res) => {
  res.json({ status: "ok", projectDir: PROJECT_DIR, uptime: process.uptime() });
});

app.get("/files/read", async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: "path required" });
    const fullPath = join(PROJECT_DIR, filePath);
    if (!fullPath.startsWith(PROJECT_DIR)) return res.status(403).json({ error: "Invalid path" });
    const content = await readFile(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (error) {
    res.status(error.code === "ENOENT" ? 404 : 500).json({ error: error.message });
  }
});

app.post("/files/write", async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files)) return res.status(400).json({ error: "files array required" });
    const results = await Promise.all(files.map(async ({ path: filePath, content }) => {
      const fullPath = join(PROJECT_DIR, filePath);
      if (!fullPath.startsWith(PROJECT_DIR)) return { path: filePath, error: "Invalid path" };
      try {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf-8");
        return { path: filePath, success: true };
      } catch (error) { return { path: filePath, error: error.message }; }
    }));
    res.json({ success: true, results });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/files/tree", async (req, res) => {
  try {
    const files = await glob("**/*", { cwd: PROJECT_DIR, nodir: true, ignore: IGNORE_PATTERNS });
    const fileList = await Promise.all(files.map(async (filePath) => {
      try {
        const stats = await stat(join(PROJECT_DIR, filePath));
        return { path: filePath, size: stats.size };
      } catch { return null; }
    }));
    res.json({ files: fileList.filter(Boolean), projectDir: PROJECT_DIR });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/exec", async (req, res) => {
  try {
    const { command, timeout = 60000 } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });
    const result = await new Promise((resolve) => {
      let output = "";
      const proc = spawn("bash", ["-c", command], { cwd: PROJECT_DIR, env: { ...process.env, FORCE_COLOR: "0" } });
      const timeoutId = setTimeout(() => { proc.kill("SIGTERM"); resolve({ exitCode: 124, output, timedOut: true }); }, timeout);
      proc.stdout.on("data", (d) => { output += d.toString(); });
      proc.stderr.on("data", (d) => { output += d.toString(); });
      proc.on("close", (code) => { clearTimeout(timeoutId); resolve({ exitCode: code ?? 0, output: output.slice(0, 100000) }); });
      proc.on("error", (e) => { clearTimeout(timeoutId); resolve({ exitCode: 1, output: e.message, error: true }); });
    });
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Logs endpoint - streams dev server logs
const LOG_FILE = "/var/log/devserver.log";
const MAX_LOG_LINES = 500;

app.get("/logs", async (req, res) => {
  try {
    const { since, tail } = req.query;
    const tailLines = parseInt(tail) || MAX_LOG_LINES;
    
    // Read the log file
    let logContent = "";
    try {
      const { readFile } = await import("fs/promises");
      logContent = await readFile(LOG_FILE, "utf-8");
    } catch (err) {
      // Log file might not exist yet
      logContent = "";
    }
    
    // Split into lines and optionally filter by timestamp
    let lines = logContent.split("\\n").filter(Boolean);
    
    // If since is provided, filter lines after that timestamp
    if (since) {
      const sinceTime = parseInt(since);
      lines = lines.filter(line => {
        const match = line.match(/^\\[(\\d+)\\]/);
        if (match) {
          return parseInt(match[1]) > sinceTime;
        }
        return true;
      });
    }
    
    // Take only the last N lines
    if (lines.length > tailLines) {
      lines = lines.slice(-tailLines);
    }
    
    // Get the latest timestamp for polling
    let latestTimestamp = Date.now();
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/^\\[(\\d+)\\]/);
      if (match) {
        latestTimestamp = parseInt(match[1]);
      }
    }
    
    res.json({
      logs: lines.join("\\n"),
      lineCount: lines.length,
      latestTimestamp,
      hasMore: logContent.split("\\n").length > tailLines
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clone/project status endpoint for polling
app.get("/clone-status", async (req, res) => {
  try {
    const { stat, readFile } = await import("fs/promises");
    const { execSync } = await import("child_process");
    
    // Check if project directory exists
    let dirExists = false;
    try {
      await stat(PROJECT_DIR);
      dirExists = true;
    } catch {}
    
    // Check if package.json exists
    let hasPackageJson = false;
    try {
      await stat(join(PROJECT_DIR, "package.json"));
      hasPackageJson = true;
    } catch {}
    
    // Check if port 3000 is listening (dev server running)
    let port3000Listening = false;
    try {
      const result = execSync("ss -tlnp | grep :3000 || true", { encoding: "utf-8" });
      port3000Listening = result.includes(":3000");
    } catch {}
    
    // Determine status
    let status = "booting";
    if (!dirExists) {
      status = "booting";
    } else if (!hasPackageJson) {
      status = "cloning";
    } else if (!port3000Listening) {
      status = "installing";
    } else {
      status = "ready";
    }
    
    res.json({ 
      status, 
      dirExists, 
      hasPackageJson, 
      port3000Listening,
      projectDir: PROJECT_DIR 
    });
  } catch (error) {
    res.status(500).json({ error: error.message, status: "unknown" });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(\`Sprite API on port \${PORT}\`));
SERVEREOF

# Create the startup script
cat > /app/start.sh << 'STARTEOF'
#!/bin/bash
set -e
source /app/.env
export GITHUB_REPO GITHUB_BRANCH GITHUB_TOKEN API_SECRET DROPLET_NAME CONVEX_SITE_URL API_PORT PROJECT_DIR NEXT_PUBLIC_CONVEX_URL

report_status() {
  local status="$1"
  local max_retries=3
  local retry_delay=2
  
  if [ -z "$CONVEX_SITE_URL" ] || [ -z "$DROPLET_NAME" ] || [ -z "$API_SECRET" ]; then
    echo "[report_status] Missing required env vars: CONVEX_SITE_URL=$CONVEX_SITE_URL DROPLET_NAME=$DROPLET_NAME"
    return 0  # Don't fail the script, just log and continue
  fi
  
  echo "[report_status] Reporting status: $status to $CONVEX_SITE_URL/droplet-status"
  
  for i in $(seq 1 $max_retries); do
    local response
    local http_code
    
    response=$(curl -s -w "\\n%{http_code}" -X POST "$CONVEX_SITE_URL/droplet-status" \
      -H "Content-Type: application/json" \
      -d "{\"dropletName\":\"$DROPLET_NAME\",\"apiSecret\":\"$API_SECRET\",\"status\":\"$status\"}" \
      --connect-timeout 10 --max-time 30 2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
      echo "[report_status] Success: $status (attempt $i)"
      return 0
    else
      echo "[report_status] Attempt $i failed: HTTP $http_code - $body"
      if [ $i -lt $max_retries ]; then
        sleep $retry_delay
      fi
    fi
  done
  
  echo "[report_status] Failed to report status after $max_retries attempts (continuing anyway)"
  return 0  # Don't fail - continue with the script even if status reporting fails
}

LOG_FILE="/var/log/devserver.log"

# Function to log with timestamp
log_line() {
  echo "[$(date +%s)] $1" >> "$LOG_FILE"
}

# Initialize log file
echo "" > "$LOG_FILE"
log_line "=== Artie Dev Server Log ==="

echo "=== Starting Sprite Server ==="

# Install API server dependencies
cd /app/sprite-server
npm install --production

# Start API server
node server.js &
API_PID=$!
sleep 2

# Clone repository
if [ -n "$GITHUB_REPO" ]; then
  report_status "cloning"
  log_line "Cloning $GITHUB_REPO branch $GITHUB_BRANCH..."
  echo "Cloning $GITHUB_REPO branch $GITHUB_BRANCH..."
  rm -rf "$PROJECT_DIR"
  CLONE_URL="https://\${GITHUB_TOKEN}@github.com/\${GITHUB_REPO}.git"
  if git clone --depth 1 --branch "$GITHUB_BRANCH" "$CLONE_URL" "$PROJECT_DIR" 2>&1 | while read line; do log_line "$line"; echo "$line"; done; then
    log_line "Clone successful"
  else
    git clone --depth 1 "$CLONE_URL" "$PROJECT_DIR" 2>&1 | while read line; do log_line "$line"; echo "$line"; done
    log_line "Clone fallback to default branch"
  fi
  
  cd "$PROJECT_DIR"
  report_status "installing"
  log_line "Installing dependencies..."
  echo "Installing dependencies..."
  if [ -f "package.json" ]; then
    (pnpm install || npm install) 2>&1 | while read line; do log_line "$line"; echo "$line"; done
  fi
  
  log_line "Starting dev server..."
  echo "Starting dev server..."
  
  # Start dev server with output redirected to log file
  if grep -q '"dev"' package.json 2>/dev/null; then
    (pnpm dev 2>&1 | while IFS= read -r line; do log_line "$line"; done) &
  elif grep -q '"start"' package.json 2>/dev/null; then
    (pnpm start 2>&1 | while IFS= read -r line; do log_line "$line"; done) &
  fi
  DEV_PID=$!
  
  # Wait for port 3000 to be listening (up to 120 seconds)
  log_line "Waiting for dev server to start on port 3000..."
  echo "Waiting for dev server to start on port 3000..."
  for i in $(seq 1 120); do
    if ss -tlnp 2>/dev/null | grep -q ":3000 " || netstat -tlnp 2>/dev/null | grep -q ":3000 "; then
      log_line "Dev server is listening on port 3000 after \${i}s"
      echo "Dev server is listening on port 3000 after \${i}s"
      break
    fi
    if [ $i -eq 120 ]; then
      log_line "Warning: Dev server did not start within 120 seconds, reporting ready anyway"
      echo "Warning: Dev server did not start within 120 seconds, reporting ready anyway"
    fi
    sleep 1
  done
fi

report_status "ready"
log_line "=== Ready ==="
echo "=== Ready ==="
wait $API_PID
STARTEOF

chmod +x /app/start.sh

# Create systemd service for auto-restart
cat > /etc/systemd/system/sprite.service << 'SVCEOF'
[Unit]
Description=Artie Sprite Server
After=network.target

[Service]
Type=simple
ExecStart=/app/start.sh
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

# Start the service
systemctl daemon-reload
systemctl enable sprite
systemctl start sprite

echo "=== Setup Complete ==="
`;
}

// Action: Create droplet on DigitalOcean
export const createDroplet = internalAction({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    console.log(`[createDroplet] Starting for droplet ${args.dropletId}`);

    const droplet = await ctx.runQuery(internal.droplets.getByIdInternal, {
      dropletId: args.dropletId,
    });

    if (!droplet) {
      console.error(`[createDroplet] Droplet ${args.dropletId} not found`);
      return;
    }

    // Get repo details
    const repo = await ctx.runQuery(api.projects.get, { repoId: droplet.repoId });
    if (!repo) {
      await ctx.runMutation(internal.droplets.markCreateFailed, {
        dropletId: args.dropletId,
        errorMessage: "Repository not found",
      });
      return;
    }

    // Get user's GitHub token (with auto-refresh)
    let githubToken: string | undefined;
    try {
      githubToken = await getUserGithubTokenById(ctx, droplet.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub token error";
      await ctx.runMutation(internal.droplets.markCreateFailed, {
        dropletId: args.dropletId,
        errorMessage: message,
      });
      return;
    }
    if (!githubToken) {
      await ctx.runMutation(internal.droplets.markCreateFailed, {
        dropletId: args.dropletId,
        errorMessage: "GitHub token not available. Please connect your GitHub account in Settings.",
      });
      return;
    }

    // Generate user data script
    const userData = generateUserData({
      githubRepo: `${repo.githubOwner}/${repo.githubRepo}`,
      githubBranch: droplet.branch ?? repo.defaultBranch,
      githubToken,
      apiSecret: droplet.apiSecret,
      dropletName: droplet.dropletName,
      convexSiteUrl:
        process.env.CONVEX_SITE_URL || "https://ceaseless-hornet-54.convex.site",
      externalConvexUrl: repo.externalConvexUrl,
    });

    // Get SSH key ID (optional, for debugging)
    const sshKeyId = process.env.DIGITALOCEAN_SSH_KEY_ID;

    // Create the droplet
    // Note: Use env var directly here since process.env is only available in Actions
    const region = process.env.DIGITALOCEAN_REGION || droplet.region || "nyc1";
    const size = process.env.DIGITALOCEAN_SIZE || droplet.size || "s-2vcpu-2gb";
    
    const createBody: Record<string, unknown> = {
      name: droplet.dropletName,
      region,
      size,
      image: "nodejs-20-04", // Ubuntu 24.04 with Node.js pre-installed
      user_data: userData,
      tags: ["artie-droplet", `team-${droplet.teamId}`],
      monitoring: true,
    };

    if (sshKeyId) {
      createBody.ssh_keys = [sshKeyId];
    }

    console.log(`[createDroplet] Creating DO droplet: ${droplet.dropletName}`);
    const response = await doApiRequest<{ droplet: { id: number } }>(
      "/droplets",
      {
        method: "POST",
        body: JSON.stringify(createBody),
      }
    );

    if (!response.ok) {
      console.error(`[createDroplet] Failed: ${response.error}`);
      await ctx.runMutation(internal.droplets.markCreateFailed, {
        dropletId: args.dropletId,
        errorMessage: `DigitalOcean API error: ${response.error}`,
      });
      return;
    }

    const doDropletId = response.data?.droplet?.id?.toString();
    if (!doDropletId) {
      await ctx.runMutation(internal.droplets.markCreateFailed, {
        dropletId: args.dropletId,
        errorMessage: "No droplet ID returned from DigitalOcean",
      });
      return;
    }

    console.log(`[createDroplet] Created DO droplet ${doDropletId}`);

    // Update status to provisioning
    await ctx.runMutation(internal.droplets.updateStatus, {
      dropletId: args.dropletId,
      status: "provisioning",
      updates: {
        dropletId: doDropletId,
      },
      reason: `do_droplet_created: ${doDropletId}`,
    });

    // Schedule action to wait for droplet to become active
    await ctx.scheduler.runAfter(5000, internal.droplets.waitForActive, {
      dropletId: args.dropletId,
    });
  },
});

// Action: Poll droplet status until active
export const waitForActive = internalAction({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    const droplet = await ctx.runQuery(internal.droplets.getByIdInternal, {
      dropletId: args.dropletId,
    });

    if (!droplet || !droplet.dropletId) {
      console.error(`[waitForActive] Droplet ${args.dropletId} not found or no DO ID`);
      return;
    }

    // Check if status has changed (e.g., user stopped it)
    if (droplet.status !== "provisioning") {
      console.log(
        `[waitForActive] Droplet ${args.dropletId} status is ${droplet.status}, stopping poll`
      );
      return;
    }

    // Check for timeout
    const elapsed = Date.now() - droplet.statusChangedAt;
    if (elapsed > TIMEOUTS.provisioning) {
      console.error(`[waitForActive] Droplet ${args.dropletId} timed out`);
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: args.dropletId,
        status: "unhealthy",
        updates: {
          errorMessage: "Droplet provisioning timed out",
        },
        reason: "provisioning_timeout",
      });
      return;
    }

    // Get droplet status from DO
    const response = await doApiRequest<{
      droplet: {
        id: number;
        status: string;
        networks: {
          v4: Array<{ ip_address: string; type: string }>;
        };
      };
    }>(`/droplets/${droplet.dropletId}`);

    if (!response.ok) {
      console.error(`[waitForActive] Failed to get droplet: ${response.error}`);
      // Retry after delay
      await ctx.scheduler.runAfter(10000, internal.droplets.waitForActive, {
        dropletId: args.dropletId,
      });
      return;
    }

    const doDroplet = response.data?.droplet;
    if (!doDroplet) {
      console.error(`[waitForActive] No droplet data returned`);
      await ctx.scheduler.runAfter(10000, internal.droplets.waitForActive, {
        dropletId: args.dropletId,
      });
      return;
    }

    console.log(`[waitForActive] DO droplet ${droplet.dropletId} status: ${doDroplet.status}`);

    if (doDroplet.status === "active") {
      // Get public IP
      const publicIp = doDroplet.networks?.v4?.find((n) => n.type === "public")?.ip_address;

      if (!publicIp) {
        console.warn(`[waitForActive] No public IP yet, retrying...`);
        await ctx.scheduler.runAfter(5000, internal.droplets.waitForActive, {
          dropletId: args.dropletId,
        });
        return;
      }

      const previewUrl = `http://${publicIp}:3000`;
      const apiUrl = `http://${publicIp}:3001`;

      console.log(`[waitForActive] Droplet ${args.dropletId} is active at ${publicIp}`);

      // Update status to booting
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: args.dropletId,
        status: "booting",
        updates: {
          ipv4Address: publicIp,
          previewUrl,
          apiUrl,
        },
        reason: `droplet_active: ${publicIp}`,
      });

      // Schedule polling to track container startup progress
      // This is a fallback in case the container's push-based status updates fail
      await ctx.scheduler.runAfter(15000, internal.droplets.pollContainerStatus, {
        dropletId: args.dropletId,
      });
    } else if (doDroplet.status === "new" || doDroplet.status === "queued") {
      // Still provisioning, poll again
      await ctx.scheduler.runAfter(5000, internal.droplets.waitForActive, {
        dropletId: args.dropletId,
      });
    } else {
      // Unexpected status
      console.error(`[waitForActive] Unexpected DO status: ${doDroplet.status}`);
      await ctx.runMutation(internal.droplets.updateStatus, {
        dropletId: args.dropletId,
        status: "unhealthy",
        updates: {
          errorMessage: `Unexpected DigitalOcean status: ${doDroplet.status}`,
        },
        reason: `unexpected_status: ${doDroplet.status}`,
      });
    }
  },
});

// Action: Poll container status as fallback
// Checks the container's API endpoint in case push-based updates fail
export const pollContainerStatus = internalAction({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    const droplet = await ctx.runQuery(internal.droplets.getByIdInternal, {
      dropletId: args.dropletId,
    });

    if (!droplet) {
      console.log(`[pollContainerStatus] Droplet ${args.dropletId} not found`);
      return;
    }

    // Only poll if still in a transitional state
    const pollableStates: DropletStatus[] = ["booting", "cloning", "installing"];
    if (!pollableStates.includes(droplet.status as DropletStatus)) {
      console.log(
        `[pollContainerStatus] Droplet ${args.dropletId} status is ${droplet.status}, stopping poll`
      );
      return;
    }

    // Check for timeout
    const elapsed = Date.now() - droplet.statusChangedAt;
    const timeout = TIMEOUTS[droplet.status as keyof typeof TIMEOUTS] || TIMEOUTS.booting;
    if (elapsed > timeout) {
      console.log(`[pollContainerStatus] Droplet ${args.dropletId} timed out in ${droplet.status}`);
      return; // Let checkTimeouts handle this
    }

    if (!droplet.apiUrl) {
      console.log(`[pollContainerStatus] Droplet ${args.dropletId} has no API URL`);
      // Reschedule
      await ctx.scheduler.runAfter(10000, internal.droplets.pollContainerStatus, {
        dropletId: args.dropletId,
      });
      return;
    }

    try {
      // Try to reach the container's health endpoint
      const healthUrl = `${droplet.apiUrl}/health`;
      console.log(`[pollContainerStatus] Checking ${healthUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(healthUrl, {
        signal: controller.signal,
        headers: droplet.apiSecret
          ? { Authorization: `Bearer ${droplet.apiSecret}` }
          : {},
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        // Container API is responding, now check clone status
        const cloneStatusUrl = `${droplet.apiUrl}/clone-status`;
        const cloneResponse = await fetch(cloneStatusUrl, {
          headers: droplet.apiSecret
            ? { Authorization: `Bearer ${droplet.apiSecret}` }
            : {},
        });

        if (cloneResponse.ok) {
          const cloneData = await cloneResponse.json() as { 
            status: string; 
            hasPackageJson?: boolean;
            dirExists?: boolean;
            port3000Listening?: boolean;
          };
          console.log(
            `[pollContainerStatus] Clone status for ${args.dropletId}: ${JSON.stringify(cloneData)}`
          );

          const currentStatus = droplet.status as DropletStatus;
          const reportedStatus = cloneData.status;
          
          // Map reported status to valid transitions and update accordingly
          // The clone-status endpoint reports: booting, cloning, installing, ready
          if (reportedStatus === "ready" && cloneData.port3000Listening) {
            if (currentStatus !== "ready" && currentStatus !== "active") {
              console.log(
                `[pollContainerStatus] Container is ready, updating status from ${currentStatus}`
              );
              await ctx.runMutation(internal.droplets.updateStatusFromContainer, {
                dropletName: droplet.dropletName,
                apiSecret: droplet.apiSecret,
                status: "ready",
              });
              return;
            }
          } else if (reportedStatus === "installing" && currentStatus === "booting") {
            // Project exists but deps being installed - skip cloning and go to installing
            console.log(`[pollContainerStatus] Detected installing state, updating from ${currentStatus}`);
            await ctx.runMutation(internal.droplets.updateStatusFromContainer, {
              dropletName: droplet.dropletName,
              apiSecret: droplet.apiSecret,
              status: "installing",
            });
          } else if (reportedStatus === "cloning" && currentStatus === "booting") {
            console.log(`[pollContainerStatus] Detected cloning state, updating from ${currentStatus}`);
            await ctx.runMutation(internal.droplets.updateStatusFromContainer, {
              dropletName: droplet.dropletName,
              apiSecret: droplet.apiSecret,
              status: "cloning",
            });
          }
        } else {
          console.log(`[pollContainerStatus] Clone status request failed: ${cloneResponse.status}`);
        }
      }
    } catch (err) {
      // Container not ready yet, this is expected during boot
      console.log(
        `[pollContainerStatus] Droplet ${args.dropletId} API not ready: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    // Reschedule poll
    await ctx.scheduler.runAfter(10000, internal.droplets.pollContainerStatus, {
      dropletId: args.dropletId,
    });
  },
});

// Action: Destroy droplet on DigitalOcean
export const destroyDroplet = internalAction({
  args: { dropletId: v.id("droplets") },
  handler: async (ctx, args) => {
    console.log(`[destroyDroplet] Starting for droplet ${args.dropletId}`);

    const droplet = await ctx.runQuery(internal.droplets.getByIdInternal, {
      dropletId: args.dropletId,
    });

    if (!droplet) {
      console.error(`[destroyDroplet] Droplet ${args.dropletId} not found`);
      return;
    }

    // If there's a DO droplet ID, delete it
    if (droplet.dropletId) {
      console.log(`[destroyDroplet] Deleting DO droplet ${droplet.dropletId}`);
      const response = await doApiRequest(`/droplets/${droplet.dropletId}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        console.error(`[destroyDroplet] Failed to delete: ${response.error}`);
        // Still mark as destroyed in our DB
      } else {
        console.log(`[destroyDroplet] DO droplet ${droplet.dropletId} deleted`);
      }
    }

    // Update status to destroyed
    await ctx.runMutation(internal.droplets.updateStatus, {
      dropletId: args.dropletId,
      status: "destroyed",
      updates: {
        destroyedAt: Date.now(),
      },
      reason: "droplet_destroyed",
    });
  },
});

// Action: List all droplets from DigitalOcean (for reconciliation)
export const listDoDroplets = internalAction({
  handler: async (): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      tags: string[];
    }>
  > => {
    const response = await doApiRequest<{
      droplets: Array<{
        id: number;
        name: string;
        status: string;
        tags: string[];
      }>;
    }>("/droplets?tag_name=artie-droplet&per_page=200");

    if (!response.ok || !response.data) {
      console.error(`[listDoDroplets] Failed: ${response.error}`);
      return [];
    }

    return response.data.droplets.map((d) => ({
      id: d.id.toString(),
      name: d.name,
      status: d.status,
      tags: d.tags,
    }));
  },
});

// Action: Delete a DO droplet by ID (for reconciliation cleanup)
export const deleteDoDroplet = internalAction({
  args: { doDropletId: v.string() },
  handler: async (ctx, args) => {
    console.log(`[deleteDoDroplet] Deleting orphaned droplet ${args.doDropletId}`);
    const response = await doApiRequest(`/droplets/${args.doDropletId}`, {
      method: "DELETE",
    });

    if (!response.ok && response.status !== 404) {
      console.error(`[deleteDoDroplet] Failed: ${response.error}`);
      return { success: false, error: response.error };
    }

    return { success: true };
  },
});
