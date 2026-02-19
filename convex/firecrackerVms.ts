import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
  ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "./_generated/dataModel";
import { internal, api } from "./_generated/api";

// Constants
const FIRECRACKER_HOST = "http://157.230.181.26:8080";

// Timeouts (much faster than Droplets)
export const TIMEOUTS = {
  creating: 30 * 1000,
  booting: 30 * 1000,
  cloning: 5 * 60 * 1000,
  installing: 15 * 60 * 1000,
  starting: 2 * 60 * 1000,
  heartbeat_warning: 60 * 1000,
  heartbeat_stop: 5 * 60 * 1000,
};

// Status type
export type FirecrackerVmStatus =
  | "requested"
  | "creating"
  | "booting"
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
const vmStatusValidator = v.union(
  v.literal("requested"),
  v.literal("creating"),
  v.literal("booting"),
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
const VALID_TRANSITIONS: Record<FirecrackerVmStatus, FirecrackerVmStatus[]> = {
  requested: ["creating", "unhealthy"],
  creating: ["booting", "unhealthy"],
  booting: ["cloning", "creating", "unhealthy"], // creating: fallback if pool VM not found on host
  cloning: ["installing", "unhealthy"],
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

// Generate a unique VM name
function generateVmName(repoName: string, sessionId: string): string {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const suffix = sessionId.slice(-8);
  return `artie-${sanitized}-${suffix}`;
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

// ====================
// QUERIES
// ====================

// Internal query to get VM by ID
export const getByIdInternal = internalQuery({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    return await ctx.db.get("firecrackerVms", args.vmId);
  },
});

// Internal query to get VMs by vmName (for callback validation)
export const getByVmName = internalQuery({
  args: { vmName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("firecrackerVms")
      .withIndex("by_vmName", (q) => q.eq("vmName", args.vmName))
      .collect();
  },
});

// Get VM for a session (authenticated)
export const getForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const vm = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (vm?.status === "destroyed") return null;
    return vm;
  },
});

// Get active VM for a repo+branch (authenticated)
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

    const vms = await ctx.db
      .query("firecrackerVms")
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

    if (vms.length === 0) return null;

    // Prefer ready/active VMs
    const readyVm = vms.find(
      (vm) => vm.status === "ready" || vm.status === "active"
    );
    if (readyVm) return readyVm;

    // Otherwise return most recently created
    return vms.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

// Get VM for preview (combines session + repo/branch lookup)
export const getForPreview = query({
  args: {
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // First check for a VM associated with this session
    const vmBySession = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (vmBySession && vmBySession.status !== "destroyed") {
      return vmBySession;
    }

    // If no session VM, check for VMs on the same repo+branch
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;

    const targetBranch = args.branch ?? repo.defaultBranch;

    const vmsForBranch = await ctx.db
      .query("firecrackerVms")
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

    if (vmsForBranch.length === 0) return null;

    // Prefer ready/active VMs
    const readyVm = vmsForBranch.find(
      (vm) => vm.status === "ready" || vm.status === "active"
    );
    if (readyVm) return readyVm;

    // Otherwise return most recently created (only consider VMs that are actually running or starting up)
    return vmsForBranch.sort((a, b) => b.createdAt - a.createdAt)[0];
  },
});

// Get VMs by status (for scheduler)
export const getByStatus = internalQuery({
  args: {
    status: vmStatusValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("firecrackerVms")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("asc");

    if (args.limit) {
      return await q.take(args.limit);
    }
    return await q.collect();
  },
});

// Get VMs stuck in a status older than a threshold (for scheduler timeouts)
export const getTimedOutVms = internalQuery({
  args: {
    status: vmStatusValidator,
    olderThan: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("firecrackerVms")
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
      .query("firecrackerVms")
      .withIndex("by_status_and_statusChangedAt", (q) =>
        q.eq("status", "destroyed").lt("statusChangedAt", args.olderThan)
      )
      .collect();

    for (const record of oldRecords) {
      await ctx.db.delete("firecrackerVms", record._id);
    }

    return { deleted: oldRecords.length };
  },
});

// ====================
// MUTATIONS
// ====================

// Request a new VM (called by frontend)
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

    // Check team membership
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", repo.teamId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new Error("Not a team member");

    const targetBranch = args.branch ?? repo.defaultBranch;

    // Check for existing VM for this session
    const existingForSession = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existingForSession) {
      if (existingForSession.status === "destroyed") {
        // Continue to create new
      } else if (existingForSession.status === "unhealthy") {
        // Retry: reset to creating and immediately schedule
        const now = Date.now();
        await ctx.db.patch("firecrackerVms", existingForSession._id, {
          status: "creating",
          statusChangedAt: now,
          errorMessage: undefined,
          retryCount: 0,
          statusHistory: [
            ...existingForSession.statusHistory,
            { status: "creating", timestamp: now, reason: "user_retry_immediate" },
          ],
        });
        // Immediately schedule VM creation
        await ctx.scheduler.runAfter(0, internal.firecrackerVms.createVm, {
          vmId: existingForSession._id,
        });
        return existingForSession._id;
      } else {
        return existingForSession._id;
      }
    }

    // Stop any existing VMs for this user on this repo (from other sessions)
    // This ensures old conversations don't keep VMs running
    const existingUserVms = await ctx.db
      .query("firecrackerVms")
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
    for (const oldVm of existingUserVms) {
      console.log(
        `[firecrackerVms:request] Stopping old VM ${oldVm._id} for user ${userId} (new session: ${args.sessionId})`
      );
      await ctx.db.patch("firecrackerVms", oldVm._id, {
        status: "stopping",
        statusChangedAt: now,
        statusHistory: [
          ...oldVm.statusHistory,
          { status: "stopping", timestamp: now, reason: "new_session_created" },
        ],
      });
    }

    // Check for existing active VM on same repo+branch (excluding just-stopped VMs)
    const vmsForBranch = await ctx.db
      .query("firecrackerVms")
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

    const readyVm = vmsForBranch.find(
      (vm) => vm.status === "ready" || vm.status === "active"
    );
    if (readyVm) return readyVm._id;

    const inProgressVm = vmsForBranch.sort(
      (a, b) => b.createdAt - a.createdAt
    )[0];
    if (inProgressVm) return inProgressVm._id;

    const apiSecret = generateApiSecret();

    // Try to get a pre-warmed VM from the pool
    const poolVm = await ctx.db
      .query("firecrackerVmPool")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .order("asc") // Oldest first
      .first();

    if (poolVm) {
      // Mark pool VM as assigned
      await ctx.db.patch("firecrackerVmPool", poolVm._id, {
        status: "assigned",
        assignedAt: now,
      });

      // Create firecrackerVms record using the pool VM - skip creating/booting!
      const vmId = await ctx.db.insert("firecrackerVms", {
        sessionId: args.sessionId,
        repoId: session.repoId,
        teamId: repo.teamId,
        userId,
        vmName: poolVm.vmName,
        vmId: poolVm.vmId,
        vmIp: poolVm.vmIp,
        hostPort: poolVm.hostPort,
        previewUrl: `http://157.230.181.26:${poolVm.hostPort}`,
        logsUrl: `http://157.230.181.26:8080/api/vms/${poolVm.vmId}/logs`,
        terminalUrl: `ws://157.230.181.26:8080/api/vms/${poolVm.vmId}/terminal`,
        status: "booting", // Start at booting, will quickly transition to cloning
        apiSecret,
        retryCount: 0,
        createdAt: now,
        statusChangedAt: now,
        statusHistory: [
          { status: "booting", timestamp: now, reason: "assigned_from_pool" },
        ],
        branch: targetBranch,
      });

      console.log(`[firecrackerVms:request] Assigned pool VM ${poolVm.vmName} to session`);

      // Immediately start setup (skip createVm since VM already exists)
      await ctx.scheduler.runAfter(0, internal.firecrackerVms.setupVm, {
        vmId,
      });

      return vmId;
    }

    // No pool VM available - create new VM the traditional way
    const vmName = generateVmName(repo.githubRepo, args.sessionId);

    const vmId = await ctx.db.insert("firecrackerVms", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      teamId: repo.teamId,
      userId,
      vmName,
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

    // Immediately schedule VM creation (bypass scheduler polling)
    await ctx.scheduler.runAfter(0, internal.firecrackerVms.createVm, {
      vmId,
    });

    return vmId;
  },
});

// Request stop (called by frontend)
export const requestStop = mutation({
  args: {
    vmId: v.id("firecrackerVms"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const vm = await ctx.db.get("firecrackerVms", args.vmId);
    if (!vm) throw new Error("VM not found");
    if (vm.userId !== userId) throw new Error("Not authorized");

    const stoppableStates: FirecrackerVmStatus[] = [
      "ready", "active", "cloning", "installing", "starting",
      "booting", "creating", "requested", "unhealthy",
    ];

    if (!stoppableStates.includes(vm.status as FirecrackerVmStatus)) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch("firecrackerVms", args.vmId, {
      status: "stopping",
      statusChangedAt: now,
      statusHistory: [
        ...vm.statusHistory,
        { status: "stopping", timestamp: now, reason: args.reason },
      ],
    });
  },
});

// Heartbeat (called by frontend every 30s)
export const heartbeat = mutation({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const vm = await ctx.db.get("firecrackerVms", args.vmId);
    if (!vm || vm.userId !== userId) return;

    const now = Date.now();
    const updates: Partial<Doc<"firecrackerVms">> = {
      lastHeartbeatAt: now,
    };

    if (vm.status === "ready") {
      updates.status = "active";
      updates.statusChangedAt = now;
      updates.statusHistory = [
        ...vm.statusHistory,
        { status: "active", timestamp: now, reason: "heartbeat_received" },
      ];
    }

    await ctx.db.patch("firecrackerVms", args.vmId, updates);
  },
});

// ====================
// INTERNAL MUTATIONS
// ====================

// Update status (with history tracking and state machine validation)
export const updateStatus = internalMutation({
  args: {
    vmId: v.id("firecrackerVms"),
    status: vmStatusValidator,
    updates: v.optional(
      v.object({
        vmId: v.optional(v.string()),
        vmIp: v.optional(v.string()),
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
    const vm = await ctx.db.get("firecrackerVms", args.vmId);
    if (!vm) {
      console.error(`[updateStatus] VM ${args.vmId} not found`);
      return { success: false, error: "VM not found" };
    }

    const currentStatus = vm.status as FirecrackerVmStatus;
    const newStatus = args.status as FirecrackerVmStatus;

    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      console.warn(
        `[updateStatus] Invalid transition: ${currentStatus} -> ${newStatus} for VM ${args.vmId}`
      );
      return {
        success: false,
        error: `Invalid transition from ${currentStatus} to ${newStatus}`,
      };
    }

    const now = Date.now();
    const update: Partial<Doc<"firecrackerVms">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...vm.statusHistory,
        { status: newStatus, timestamp: now, reason: args.reason },
      ],
    };

    if (args.updates) {
      if (args.updates.vmId !== undefined) update.vmId = args.updates.vmId;
      if (args.updates.vmIp !== undefined) update.vmIp = args.updates.vmIp;
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

    await ctx.db.patch("firecrackerVms", args.vmId, update);

    console.log(
      `[updateStatus] VM ${args.vmId}: ${currentStatus} -> ${newStatus} (${args.reason || "no reason"})`
    );
    return { success: true };
  },
});

// Update status from host callback (validates apiSecret)
export const updateStatusFromHost = internalMutation({
  args: {
    vmName: v.string(),
    apiSecret: v.string(),
    status: v.union(
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("starting"),
      v.literal("ready"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const vms = await ctx.db
      .query("firecrackerVms")
      .withIndex("by_vmName", (q) => q.eq("vmName", args.vmName))
      .collect();

    if (vms.length === 0) {
      console.log(`[updateStatusFromHost] VM not found: ${args.vmName}`);
      return { success: false, error: "VM not found" };
    }

    const vm = vms.find((v) => v.apiSecret === args.apiSecret);
    if (!vm) {
      console.log(`[updateStatusFromHost] Secret mismatch for ${args.vmName}`);
      return { success: false, error: "Invalid secret" };
    }

    if (vm.status === "destroyed") {
      return { success: true };
    }

    const now = Date.now();
    const currentStatus = vm.status as FirecrackerVmStatus;

    let newStatus: FirecrackerVmStatus;
    if (args.status === "failed") {
      newStatus = "unhealthy";
    } else {
      newStatus = args.status;
    }

    // Allow the transition for host reports
    const validTransitions = VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      console.warn(
        `[updateStatusFromHost] Allowing irregular transition: ${currentStatus} -> ${newStatus}`
      );
    }

    const update: Partial<Doc<"firecrackerVms">> = {
      status: newStatus,
      statusChangedAt: now,
      statusHistory: [
        ...vm.statusHistory,
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

    await ctx.db.patch("firecrackerVms", vm._id, update);
    console.log(
      `[updateStatusFromHost] VM ${vm._id}: ${currentStatus} -> ${newStatus}`
    );
    return { success: true };
  },
});

// ====================
// ACTIONS
// ====================

// Create VM on Firecracker host
export const createVm = internalAction({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    console.log(`[createVm] Starting for VM ${args.vmId}`);

    const vm = await ctx.runQuery(internal.firecrackerVms.getByIdInternal, {
      vmId: args.vmId,
    });
    if (!vm) {
      console.error(`[createVm] VM ${args.vmId} not found`);
      return;
    }

    const apiSecret = process.env.FIRECRACKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: "FIRECRACKER_API_SECRET not configured" },
        reason: "missing_config",
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
          name: vm.vmName,
          memory: 2048,
          vcpus: 2,
          ports: [3000],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[createVm] Host API error: ${error}`);

        if (vm.retryCount + 1 >= MAX_RETRIES) {
          await ctx.runMutation(internal.firecrackerVms.updateStatus, {
            vmId: args.vmId,
            status: "unhealthy",
            updates: { errorMessage: `Failed to create VM after ${MAX_RETRIES} attempts: ${error}` },
            reason: "create_failed_max_retries",
          });
        } else {
          await ctx.runMutation(internal.firecrackerVms.updateStatus, {
            vmId: args.vmId,
            status: "unhealthy",
            updates: { errorMessage: `Failed to create VM: ${error}` },
            reason: "create_failed",
          });
        }
        return;
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        status: string;
        ip: string;
        ports?: Array<{ guest: number; host: number }>;
      };

      const hostPort = data.ports?.[0]?.host;

      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "booting",
        updates: {
          vmId: data.id,
          vmIp: data.ip,
          hostPort,
          previewUrl: hostPort ? `http://157.230.181.26:${hostPort}` : undefined,
          logsUrl: `http://157.230.181.26:8080/api/vms/${data.id}/logs`,
          terminalUrl: `ws://157.230.181.26:8080/api/vms/${data.id}/terminal`,
        },
        reason: "vm_created",
      });

      // Schedule setup immediately - Firecracker VMs boot in <125ms
      await ctx.scheduler.runAfter(0, internal.firecrackerVms.setupVm, {
        vmId: args.vmId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[createVm] Error: ${message}`);
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: `Create VM error: ${message}` },
        reason: "create_error",
      });
    }
  },
});

// Setup VM (clone repo and start dev server)
export const setupVm = internalAction({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    console.log(`[setupVm] Starting for VM ${args.vmId}`);

    const vm = await ctx.runQuery(internal.firecrackerVms.getByIdInternal, {
      vmId: args.vmId,
    });
    if (!vm || !vm.vmId) {
      console.error(`[setupVm] VM ${args.vmId} not found or no host VM ID`);
      return;
    }

    // Get repo details
    const repo = await ctx.runQuery(api.projects.get, { repoId: vm.repoId });
    if (!repo) {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: "Repository not found" },
        reason: "repo_not_found",
      });
      return;
    }

    // Get GitHub token
    let githubToken: string | undefined;
    try {
      githubToken = await getUserGithubTokenById(ctx, vm.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub token error";
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: message },
        reason: "github_token_error",
      });
      return;
    }

    if (!githubToken) {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: "GitHub token not available" },
        reason: "no_github_token",
      });
      return;
    }

    const apiSecret = process.env.FIRECRACKER_API_SECRET;
    if (!apiSecret) {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: "FIRECRACKER_API_SECRET not configured" },
        reason: "missing_config",
      });
      return;
    }

    const hostUrl = process.env.FIRECRACKER_HOST_URL || FIRECRACKER_HOST;
    const callbackUrl = process.env.CONVEX_SITE_URL + "/firecracker-status";

    try {
      const response = await fetch(`${hostUrl}/api/vms/${vm.vmId}/setup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: `${repo.githubOwner}/${repo.githubRepo}`,
          branch: vm.branch || repo.defaultBranch,
          githubToken,
          callbackUrl,
          callbackSecret: vm.apiSecret,
          envVars: {
            // Include custom env vars from repo settings
            ...(repo.envVars?.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {}) ?? {}),
            // External Convex settings override custom env vars if set
            ...(repo.externalConvexUrl ? { NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl } : {}),
            ...(repo.externalConvexDeployment ? { CONVEX_DEPLOYMENT: repo.externalConvexDeployment } : {}),
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[setupVm] Setup failed: ${error}`);

        // If the VM doesn't exist on the host (e.g., pool VM was recycled),
        // fall back to creating a fresh VM instead of going unhealthy
        if (response.status === 404 || error.includes("VM not found")) {
          console.log(`[setupVm] VM not found on host, falling back to createVm`);
          await ctx.runMutation(internal.firecrackerVms.updateStatus, {
            vmId: args.vmId,
            status: "creating",
            updates: {
              vmId: undefined,
              vmIp: undefined,
              hostPort: undefined,
              previewUrl: undefined,
              logsUrl: undefined,
              terminalUrl: undefined,
            },
            reason: "pool_vm_not_found_fallback",
          });
          // Schedule fresh VM creation
          await ctx.scheduler.runAfter(0, internal.firecrackerVms.createVm, {
            vmId: args.vmId,
          });
          return;
        }

        await ctx.runMutation(internal.firecrackerVms.updateStatus, {
          vmId: args.vmId,
          status: "unhealthy",
          updates: { errorMessage: `Setup failed: ${error}` },
          reason: "setup_failed",
        });
      }
      // Status updates will come via HTTP callback from host
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[setupVm] Error: ${message}`);
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "unhealthy",
        updates: { errorMessage: `Setup error: ${message}` },
        reason: "setup_error",
      });
    }
  },
});

// Destroy VM on Firecracker host
export const destroyVm = internalAction({
  args: { vmId: v.id("firecrackerVms") },
  handler: async (ctx, args) => {
    console.log(`[destroyVm] Starting for VM ${args.vmId}`);

    const vm = await ctx.runQuery(internal.firecrackerVms.getByIdInternal, {
      vmId: args.vmId,
    });
    if (!vm) {
      console.error(`[destroyVm] VM ${args.vmId} not found`);
      return;
    }

    // Transition to destroying first (skip if already destroying, e.g. from scheduler)
    if (vm.status !== "destroying") {
      await ctx.runMutation(internal.firecrackerVms.updateStatus, {
        vmId: args.vmId,
        status: "destroying",
        reason: "destroy_started",
      });
    }

    if (vm.vmId) {
      const apiSecret = process.env.FIRECRACKER_API_SECRET;
      const hostUrl = process.env.FIRECRACKER_HOST_URL || FIRECRACKER_HOST;

      try {
        console.log(`[destroyVm] Deleting VM ${vm.vmId} from host`);
        const response = await fetch(`${hostUrl}/api/vms/${vm.vmId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiSecret}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.error(`[destroyVm] Failed to delete: ${await response.text()}`);
        } else {
          console.log(`[destroyVm] VM ${vm.vmId} deleted from host`);
        }
      } catch (err) {
        console.error(
          `[destroyVm] Error deleting VM: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    await ctx.runMutation(internal.firecrackerVms.updateStatus, {
      vmId: args.vmId,
      status: "destroyed",
      updates: { destroyedAt: Date.now() },
      reason: "vm_destroyed",
    });
  },
});

// ====================
// SNAPSHOT FUNCTIONS
// ====================

// Record snapshot creation from host callback
export const recordSnapshot = internalMutation({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    commitSha: v.string(),
    sizeBytes: v.number(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing snapshot
    const existing = await ctx.db
      .query("repoSnapshots")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .first();

    if (existing) {
      // Update existing snapshot
      await ctx.db.patch("repoSnapshots", existing._id, {
        commitSha: args.commitSha,
        sizeBytes: args.sizeBytes,
        createdAt: now,
        createdBy: args.createdBy,
        status: "ready",
        errorMessage: undefined,
      });
      console.log(
        `[recordSnapshot] Updated snapshot for repo ${args.repoId} branch ${args.branch}`
      );
      return existing._id;
    }

    // Create new snapshot record
    const snapshotId = await ctx.db.insert("repoSnapshots", {
      repoId: args.repoId,
      branch: args.branch,
      commitSha: args.commitSha,
      sizeBytes: args.sizeBytes,
      createdAt: now,
      createdBy: args.createdBy,
      status: "ready",
      useCount: 0,
    });

    console.log(
      `[recordSnapshot] Created snapshot ${snapshotId} for repo ${args.repoId} branch ${args.branch}`
    );
    return snapshotId;
  },
});

// Get snapshot for a repo/branch
export const getSnapshot = internalQuery({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("repoSnapshots")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .filter((q) => q.eq(q.field("status"), "ready"))
      .first();
  },
});

// Record snapshot usage (for analytics)
export const recordSnapshotUsage = internalMutation({
  args: {
    snapshotId: v.id("repoSnapshots"),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get("repoSnapshots", args.snapshotId);
    if (!snapshot) return;

    await ctx.db.patch("repoSnapshots", args.snapshotId, {
      lastUsedAt: Date.now(),
      useCount: (snapshot.useCount || 0) + 1,
    });
  },
});

// Mark snapshot as failed
export const markSnapshotFailed = internalMutation({
  args: {
    repoId: v.id("repos"),
    branch: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repoSnapshots")
      .withIndex("by_repoId_branch", (q) =>
        q.eq("repoId", args.repoId).eq("branch", args.branch)
      )
      .first();

    if (existing) {
      await ctx.db.patch("repoSnapshots", existing._id, {
        status: "failed",
        errorMessage: args.errorMessage,
      });
    }
  },
});
