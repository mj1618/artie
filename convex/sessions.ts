import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = mutation({
  args: {
    repoId: v.id("repos"),
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
    return sessions.filter((s) => s.userId === userId);
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
