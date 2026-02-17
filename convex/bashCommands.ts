import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";

export const saveBashCommand = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    messageId: v.id("messages"),
    command: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bashCommands", {
      sessionId: args.sessionId,
      messageId: args.messageId,
      command: args.command,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const getPendingCommand = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bashCommands")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("asc")
      .first();
  },
});

export const getLatestCommand = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bashCommands")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
  },
});

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bashCommands")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const getByMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bashCommands")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .collect();
  },
});

export const markRunning = mutation({
  args: { bashCommandId: v.id("bashCommands") },
  handler: async (ctx, args) => {
    await ctx.db.patch("bashCommands", args.bashCommandId, {
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const markCompleted = mutation({
  args: {
    bashCommandId: v.id("bashCommands"),
    output: v.string(),
    exitCode: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("bashCommands", args.bashCommandId, {
      status: args.exitCode === 0 ? "completed" : "failed",
      output: args.output,
      exitCode: args.exitCode,
      completedAt: Date.now(),
    });
  },
});

export const markFailed = mutation({
  args: {
    bashCommandId: v.id("bashCommands"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("bashCommands", args.bashCommandId, {
      status: "failed",
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

// Query to get a bash command by ID (for internal use / actions)
export const getByIdInternal = query({
  args: { bashCommandId: v.id("bashCommands") },
  handler: async (ctx, args) => {
    return await ctx.db.get("bashCommands", args.bashCommandId);
  },
});
