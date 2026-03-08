import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";

export const get = query({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("repos", args.repoId);
  },
});

export const listByTeam = query({
  args: {
    teamId: v.id("teams"),
  },
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
    return await ctx.db
      .query("repos")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const addRepo = mutation({
  args: {
    teamId: v.id("teams"),
    githubOwner: v.string(),
    githubRepo: v.string(),
    defaultBranch: v.optional(v.string()),
    pushStrategy: v.union(v.literal("direct"), v.literal("pr")),
    runtime: v.optional(v.union(v.literal("docker"), v.literal("flyio-sprite"), v.literal("firecracker"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    const existing = await ctx.db
      .query("repos")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .filter((q) =>
        q.and(
          q.eq(q.field("githubOwner"), args.githubOwner),
          q.eq(q.field("githubRepo"), args.githubRepo),
        ),
      )
      .first();
    if (existing) throw new Error("Repository already connected");

    return await ctx.db.insert("repos", {
      teamId: args.teamId,
      githubOwner: args.githubOwner,
      githubRepo: args.githubRepo,
      githubUrl: `https://github.com/${args.githubOwner}/${args.githubRepo}`,
      defaultBranch: args.defaultBranch ?? "main",
      pushStrategy: args.pushStrategy,
      connectedBy: userId,
      connectedAt: Date.now(),
      runtime: args.runtime ?? "firecracker",
    });
  },
});

export const getRepoWithTeam = query({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) return null;
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", repo.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return null;
    const team = await ctx.db.get("teams", repo.teamId);
    return { ...repo, teamName: team?.name ?? "Unknown", myRole: membership.role };
  },
});

export const updateRepo = mutation({
  args: {
    repoId: v.id("repos"),
    pushStrategy: v.optional(v.union(v.literal("direct"), v.literal("pr"))),
    defaultBranch: v.optional(v.string()),
    runtime: v.optional(v.union(v.literal("docker"), v.literal("flyio-sprite"), v.literal("firecracker"))),
    externalConvexUrl: v.optional(v.string()),
    externalConvexDeployment: v.optional(v.string()),
    clearExternalConvex: v.optional(v.boolean()),
    envVars: v.optional(v.array(v.object({
      key: v.string(),
      value: v.string(),
    }))),
    customPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) throw new Error("Repo not found");
    const team = await ctx.db.get("teams", repo.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    const updates: Partial<{
      pushStrategy: "direct" | "pr";
      defaultBranch: string;
      runtime: "docker" | "flyio-sprite" | "firecracker";
      externalConvexUrl: string;
      externalConvexDeployment: string;
      envVars: Array<{ key: string; value: string }>;
      customPrompt: string;
    }> = {};
    if (args.pushStrategy !== undefined) updates.pushStrategy = args.pushStrategy;
    if (args.defaultBranch !== undefined) updates.defaultBranch = args.defaultBranch;
    if (args.runtime !== undefined) updates.runtime = args.runtime;
    if (args.clearExternalConvex) {
      await ctx.db.patch("repos", args.repoId, {
        externalConvexUrl: undefined,
        externalConvexDeployment: undefined,
      });
      return;
    }
    if (args.externalConvexUrl !== undefined) updates.externalConvexUrl = args.externalConvexUrl;
    if (args.externalConvexDeployment !== undefined) updates.externalConvexDeployment = args.externalConvexDeployment;
    if (args.envVars !== undefined) updates.envVars = args.envVars;
    if (args.customPrompt !== undefined) updates.customPrompt = args.customPrompt;
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch("repos", args.repoId, updates);
    }
  },
});

export const removeRepo = mutation({
  args: {
    repoId: v.id("repos"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const repo = await ctx.db.get("repos", args.repoId);
    if (!repo) throw new Error("Repo not found");
    const team = await ctx.db.get("teams", repo.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("repos", args.repoId);
  },
});

export const hasAnyRepos = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    // Get all teams the user is on
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    // Check if any team has at least one repo (exit early on first found)
    for (const m of memberships) {
      const repo = await ctx.db
        .query("repos")
        .withIndex("by_teamId", (q) => q.eq("teamId", m.teamId))
        .first();
      if (repo) return true;
    }
    return false;
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    // Get all teams the user is on
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    // Get all repos from all teams in parallel
    const reposArrays = await Promise.all(
      memberships.map(async (m) => {
        const team = await ctx.db.get("teams", m.teamId);
        const repos = await ctx.db
          .query("repos")
          .withIndex("by_teamId", (q) => q.eq("teamId", m.teamId))
          .collect();
        return repos.map((repo) => ({
          ...repo,
          teamName: team?.name ?? "Unknown",
        }));
      }),
    );
    return reposArrays.flat();
  },
});

export const migrateAllToSprites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allRepos = await ctx.db.query("repos").collect();
    let updated = 0;
    for (const repo of allRepos) {
      if (repo.runtime !== "flyio-sprite") {
        await ctx.db.patch("repos", repo._id, { runtime: "flyio-sprite" });
        updated++;
      }
    }
    return { total: allRepos.length, updated };
  },
});

export const migrateAllToFirecracker = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allRepos = await ctx.db.query("repos").collect();
    let updated = 0;
    for (const repo of allRepos) {
      if (repo.runtime !== "firecracker") {
        await ctx.db.patch("repos", repo._id, { runtime: "firecracker" });
        updated++;
      }
    }
    return { total: allRepos.length, updated };
  },
});

// Internal: find repo by GitHub name (for CLI testing)
export const findRepoByGithubName = internalQuery({
  args: { githubRepo: v.string() },
  handler: async (ctx, args) => {
    const repos = await ctx.db.query("repos").collect();
    return repos.find((r) => r.githubRepo === args.githubRepo) ?? null;
  },
});

// Internal: list all repos (for CLI testing)
export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("repos").collect();
  },
});

