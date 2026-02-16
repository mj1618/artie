import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    return await ctx.db
      .query("templateProjects")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const get = query({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) return null;
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", project.teamId).eq("userId", userId),
      )
      .first();
    if (!membership) return null;
    return project;
  },
});

export const create = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    slug: v.string(),
    template: v.literal("nextjs-convex"),
    flyioDeployKeyId: v.id("flyioDeployKeys"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    // Verify the deploy key exists and belongs to this team
    const deployKey = await ctx.db.get("flyioDeployKeys", args.flyioDeployKeyId);
    if (!deployKey || deployKey.teamId !== args.teamId)
      throw new Error("Deploy key not found");

    // Check slug uniqueness within our system
    const existingSlug = await ctx.db
      .query("templateProjects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.toLowerCase()))
      .first();
    if (existingSlug) throw new Error("Slug already in use");

    return await ctx.db.insert("templateProjects", {
      teamId: args.teamId,
      name: args.name.trim(),
      slug: args.slug.toLowerCase().trim(),
      template: args.template,
      createdBy: userId,
      createdAt: Date.now(),
      convexProjectId: "",
      convexDeploymentUrl: "",
      convexDeployKey: "",
      flyioAppName: `artie-${args.slug.toLowerCase()}`,
      flyioDeployKey: deployKey.encryptedKey,
      status: "provisioning",
    });
  },
});

export const updateStatus = mutation({
  args: {
    projectId: v.id("templateProjects"),
    status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    convexProjectId: v.optional(v.string()),
    convexDeploymentUrl: v.optional(v.string()),
    convexDeployKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) throw new Error("Project not found");
    const updates: Record<string, unknown> = { status: args.status };
    if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
    if (args.convexProjectId !== undefined) updates.convexProjectId = args.convexProjectId;
    if (args.convexDeploymentUrl !== undefined) updates.convexDeploymentUrl = args.convexDeploymentUrl;
    if (args.convexDeployKey !== undefined) updates.convexDeployKey = args.convexDeployKey;
    await ctx.db.patch("templateProjects", args.projectId, updates);
  },
});

export const remove = mutation({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const project = await ctx.db.get("templateProjects", args.projectId);
    if (!project) throw new Error("Project not found");
    const team = await ctx.db.get("teams", project.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("templateProjects", args.projectId);
  },
});

export const checkSlugAvailable = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("templateProjects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.toLowerCase()))
      .first();
    return !existing;
  },
});
