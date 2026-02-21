import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";

export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", args.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];
    if (membership.role !== "owner") return [];
    const keys = await ctx.db
      .query("flyioDeployKeys")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
    return keys.map((k) => ({
      _id: k._id,
      name: k.name,
      userId: k.userId,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  },
});

export const addDeployKey = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    return await ctx.db.insert("flyioDeployKeys", {
      teamId: args.teamId,
      userId,
      name: args.name.trim(),
      encryptedKey: args.key,
      createdAt: Date.now(),
    });
  },
});

export const deleteDeployKey = mutation({
  args: { keyId: v.id("flyioDeployKeys") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const key = await ctx.db.get("flyioDeployKeys", args.keyId);
    if (!key) throw new Error("Key not found");
    const team = await ctx.db.get("teams", key.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("flyioDeployKeys", args.keyId);
  },
});
