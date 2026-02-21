import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "./auth";
import { v } from "convex/values";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      _id: identity.subject,
      email: identity.email,
      name: identity.name,
    };
  },
});

export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const userId = identity.subject;
    const email = identity.email;
    const name = identity.name;
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      if (!existing.email && email) {
        await ctx.db.patch("userProfiles", existing._id, { email });
      }
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: name ?? email ?? "User",
        email: email ?? undefined,
      });
    }
  },
});

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return profile;
  },
});

export const updateProfile = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const email = identity.email;
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch("userProfiles", existing._id, {
        displayName: args.displayName,
        ...(email && !existing.email ? { email } : {}),
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: args.displayName,
        email: email ?? undefined,
      });
    }
  },
});

export const connectGithub = mutation({
  args: {
    githubAccessToken: v.string(),
    githubUsername: v.string(),
    githubRefreshToken: v.optional(v.string()),
    githubTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const email = identity.email;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch("userProfiles", profile._id, {
        githubAccessToken: args.githubAccessToken,
        githubRefreshToken: args.githubRefreshToken,
        githubTokenExpiresAt: args.githubTokenExpiresAt,
        githubUsername: args.githubUsername,
        ...(email && !profile.email ? { email } : {}),
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: args.githubUsername,
        email: email ?? undefined,
        githubAccessToken: args.githubAccessToken,
        githubRefreshToken: args.githubRefreshToken,
        githubTokenExpiresAt: args.githubTokenExpiresAt,
        githubUsername: args.githubUsername,
      });
    }
  },
});

export const updateGithubTokens = mutation({
  args: {
    githubAccessToken: v.string(),
    githubRefreshToken: v.optional(v.string()),
    githubTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    await ctx.db.patch("userProfiles", profile._id, {
      githubAccessToken: args.githubAccessToken,
      githubRefreshToken: args.githubRefreshToken,
      githubTokenExpiresAt: args.githubTokenExpiresAt,
    });
  },
});

export const disconnectGithub = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch("userProfiles", profile._id, {
        githubAccessToken: undefined,
        githubRefreshToken: undefined,
        githubTokenExpiresAt: undefined,
        githubUsername: undefined,
      });
    }
  },
});

// Internal query to get profile by user ID (for actions)
export const getProfileById = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

// Internal mutation to update GitHub tokens by user ID (for background actions)
export const updateGithubTokensById = internalMutation({
  args: {
    userId: v.string(),
    githubAccessToken: v.string(),
    githubRefreshToken: v.optional(v.string()),
    githubTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    await ctx.db.patch("userProfiles", profile._id, {
      githubAccessToken: args.githubAccessToken,
      githubRefreshToken: args.githubRefreshToken,
      githubTokenExpiresAt: args.githubTokenExpiresAt,
    });
  },
});

// Internal mutation to disconnect GitHub by user ID (for background actions)
export const disconnectGithubById = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (profile) {
      await ctx.db.patch("userProfiles", profile._id, {
        githubAccessToken: undefined,
        githubRefreshToken: undefined,
        githubTokenExpiresAt: undefined,
        githubUsername: undefined,
      });
    }
  },
});
