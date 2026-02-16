import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";

export const saveFileChanges = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    messageId: v.id("messages"),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
        originalContent: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("fileChanges", {
      sessionId: args.sessionId,
      messageId: args.messageId,
      files: args.files,
      applied: false,
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    return await ctx.db.get("fileChanges", args.fileChangeId);
  },
});

export const getFileChanges = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();
  },
});

export const getByMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileChanges")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
  },
});

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const getCurrentFiles = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const allChanges = await ctx.db
      .query("fileChanges")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    const currentFiles: Record<string, string> = {};
    for (const change of allChanges) {
      if (change.reverted) continue;
      for (const file of change.files) {
        currentFiles[file.path] = file.content;
      }
    }
    return currentFiles;
  },
});

export const markApplied = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, { applied: true });
  },
});

export const markFailed = mutation({
  args: {
    fileChangeId: v.id("fileChanges"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, {
      error: args.error,
    });
  },
});

export const clearError = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, {
      error: undefined,
    });
  },
});

export const revertFileChange = mutation({
  args: { fileChangeId: v.id("fileChanges") },
  handler: async (ctx, args) => {
    await ctx.db.patch("fileChanges", args.fileChangeId, {
      reverted: true,
      applied: false,
    });
  },
});
