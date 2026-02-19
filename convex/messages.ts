import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  args: {
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    imageIds: v.optional(v.array(v.id("_storage"))),
    changes: v.optional(
      v.object({
        files: v.array(v.string()),
        committed: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: args.role,
      content: args.content,
      timestamp: Date.now(),
      ...(args.imageIds && args.imageIds.length > 0 ? { imageIds: args.imageIds } : {}),
      ...(args.changes ? { changes: args.changes } : {}),
    });

    const session = await ctx.db.get("sessions", args.sessionId);
    const patchFields: Record<string, unknown> = {
      lastActiveAt: Date.now(),
    };
    if (args.role === "user" && session && !session.firstMessage) {
      patchFields.firstMessage = args.content.slice(0, 100);
    }
    await ctx.db.patch("sessions", args.sessionId, patchFields);

    return messageId;
  },
});

export const get = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get("messages", args.messageId);
  },
});

export const list = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const createStreamingMessage = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      streaming: true,
    });

    await ctx.db.patch("sessions", args.sessionId, {
      lastActiveAt: Date.now(),
    });

    return messageId;
  },
});

export const updateStreamingContent = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      content: args.content,
    });
  },
});

export const updateStreamingRawOutput = mutation({
  args: {
    messageId: v.id("messages"),
    rawOutput: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      rawOutput: args.rawOutput,
    });
  },
});

export const finalizeStreamingMessage = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    rawOutput: v.optional(v.string()),
    changes: v.optional(
      v.object({
        files: v.array(v.string()),
        committed: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, {
      content: args.content,
      streaming: false,
      ...(args.rawOutput ? { rawOutput: args.rawOutput } : {}),
      ...(args.changes ? { changes: args.changes } : {}),
    });
  },
});

export const getLatestRawOutput = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
    
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.rawOutput) {
        return { messageId: msg._id, rawOutput: msg.rawOutput, timestamp: msg.timestamp };
      }
    }
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getImageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const markChangesCommitted = mutation({
  args: {
    messageId: v.id("messages"),
    commitSha: v.string(),
    prUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message || !message.changes) {
      throw new Error("Message not found or has no changes");
    }

    await ctx.db.patch("messages", args.messageId, {
      changes: {
        ...message.changes,
        committed: true,
        commitSha: args.commitSha,
        prUrl: args.prUrl,
      },
    });
  },
});
