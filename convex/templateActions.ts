"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const provisionProject = action({
  args: { projectId: v.id("templateProjects") },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.templates.get, { projectId: args.projectId });
    if (!project) throw new Error("Project not found");
    if (project.status !== "provisioning") throw new Error("Project is not in provisioning state");

    try {
      // Simulate provisioning delay
      // In production, this would call Convex API + Fly.io API
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Generate placeholder values
      const convexProjectId = `proj_${project.slug}_${Date.now()}`;
      const convexDeploymentUrl = `https://${project.slug}.convex.cloud`;
      const convexDeployKey = `deploy:${project.slug}:placeholder`;

      // Update the project to active
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "active",
        convexProjectId,
        convexDeploymentUrl,
        convexDeployKey,
      });

      return { success: true };
    } catch (error) {
      // On failure, set status to error
      await ctx.runMutation(api.templates.updateStatus, {
        projectId: args.projectId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown provisioning error",
      });
      throw error;
    }
  },
});
