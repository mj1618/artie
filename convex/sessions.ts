import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = mutation({
  args: {
    repoId: v.id("repos"),
    branchName: v.optional(v.string()),
    featureName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const now = Date.now();
    return await ctx.db.insert("sessions", {
      repoId: args.repoId,
      userId,
      createdAt: now,
      lastActiveAt: now,
      branchName: args.branchName,
      featureName: args.featureName,
    });
  },
});

export const updateLastActive = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("sessions", args.sessionId, {
      lastActiveAt: Date.now(),
    });
  },
});

export const listByRepo = query({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .order("desc")
      .collect();
    const userSessions = sessions.filter((s) => s.userId === userId);

    const sessionsWithStatus = await Promise.all(
      userSessions.map(async (session) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect();

        const hasChanges = messages.some((m) => m.changes && m.changes.files.length > 0);
        const hasPushedChanges = messages.some((m) => m.changes?.committed);
        const hasPrUrl = messages.some((m) => m.changes?.prUrl);

        let status: "empty" | "has_changes" | "pushed" | "pr_open" = "empty";
        if (hasPrUrl) {
          status = "pr_open";
        } else if (hasPushedChanges) {
          status = "pushed";
        } else if (hasChanges) {
          status = "has_changes";
        }

        return { ...session, status };
      }),
    );

    return sessionsWithStatus;
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 5;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const sorted = sessions
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, limit);

    const resolved = await Promise.all(
      sorted.map(async (session) => {
        const repo = await ctx.db.get("repos", session.repoId);
        return {
          ...session,
          repoName: repo
            ? `${repo.githubOwner}/${repo.githubRepo}`
            : "Unknown repo",
        };
      }),
    );

    return resolved;
  },
});

export const requestStop = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");
    await ctx.db.patch("sessions", args.sessionId, { stopRequested: true });
  },
});

export const clearStop = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch("sessions", args.sessionId, { stopRequested: undefined });
  },
});

export const setBranchName = mutation({
  args: {
    sessionId: v.id("sessions"),
    branchName: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");
    await ctx.db.patch("sessions", args.sessionId, {
      branchName: args.branchName,
    });
  },
});

export const get = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("sessions", args.sessionId);
  },
});

export const getPreviewCode = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    return session?.previewCode ?? null;
  },
});

export const updatePreviewCode = mutation({
  args: {
    sessionId: v.id("sessions"),
    previewCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("sessions", args.sessionId, {
      previewCode: args.previewCode,
      lastActiveAt: Date.now(),
    });
  },
});

export const renameSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    await ctx.db.patch("sessions", args.sessionId, {
      name: args.name.trim() || undefined,
    });
  },
});

export const deleteSession = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    // Delete all messages in this session
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    await Promise.all(messages.map((m) => ctx.db.delete("messages", m._id)));

    // Delete all file changes in this session
    const fileChanges = await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    await Promise.all(
      fileChanges.map((fc) => ctx.db.delete("fileChanges", fc._id)),
    );

    // Delete the session itself
    await ctx.db.delete("sessions", args.sessionId);
  },
});

export const createDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Reuse existing demo team or create one
    const existingTeam = await ctx.db.query("teams").first();
    let teamId;
    if (existingTeam) {
      teamId = existingTeam._id;
    } else {
      teamId = await ctx.db.insert("teams", {
        name: "Demo Team",
        ownerId: "demo-user",
      });
    }

    // Reuse existing demo repo or create one
    const existingRepo = await ctx.db.query("repos").first();
    let repoId;
    if (existingRepo) {
      repoId = existingRepo._id;
    } else {
      repoId = await ctx.db.insert("repos", {
        teamId,
        githubOwner: "demo",
        githubRepo: "my-project",
        githubUrl: "https://github.com/demo/my-project",
        defaultBranch: "main",
        pushStrategy: "direct" as const,
        connectedBy: "demo-user",
        connectedAt: now,
      });
    }

    // Create the session
    return await ctx.db.insert("sessions", {
      repoId,
      userId: "demo-user",
      createdAt: now,
      lastActiveAt: now,
    });
  },
});
