import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Generate a unique app name for the Sprite
function generateAppName(repoName: string, sessionId: string): string {
  const sanitized = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const suffix = sessionId.slice(-8);
  return `artie-${sanitized}-${suffix}`;
}

// Get the Sprite for a session
export const getBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("flyioSprites")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();
  },
});

// Get Sprite by app name
export const getByAppName = query({
  args: { appName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("flyioSprites")
      .withIndex("by_appName", (q) => q.eq("appName", args.appName))
      .first();
  },
});

// Request a new Sprite for a session
export const provision = mutation({
  args: {
    sessionId: v.id("sessions"),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get session and verify access
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    const repo = await ctx.db.get("repos", session.repoId);
    if (!repo) throw new Error("Repository not found");

    // Check if Sprite already exists for this session
    const existing = await ctx.db
      .query("flyioSprites")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      // If stopped, restart it
      if (existing.status === "stopped") {
        await ctx.db.patch("flyioSprites", existing._id, {
          status: "provisioning",
          lastActiveAt: Date.now(),
          stoppedAt: undefined,
          errorMessage: undefined,
        });
        return existing._id;
      }
      // If error, allow retry
      if (existing.status === "error") {
        await ctx.db.patch("flyioSprites", existing._id, {
          status: "provisioning",
          lastActiveAt: Date.now(),
          errorMessage: undefined,
        });
        return existing._id;
      }
      // Otherwise return existing
      return existing._id;
    }

    // Create new Sprite record
    const appName = generateAppName(repo.githubRepo, args.sessionId);
    const spriteId = await ctx.db.insert("flyioSprites", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      userId,
      appName,
      status: "provisioning",
      branch: args.branch ?? repo.defaultBranch,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    return spriteId;
  },
});

// Internal mutation to update Sprite status (called by actions)
export const updateStatus = internalMutation({
  args: {
    spriteId: v.id("flyioSprites"),
    status: v.union(
      v.literal("provisioning"),
      v.literal("deploying"),
      v.literal("running"),
      v.literal("stopping"),
      v.literal("stopped"),
      v.literal("error")
    ),
    previewUrl: v.optional(v.string()),
    machineId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sprite = await ctx.db.get("flyioSprites", args.spriteId);
    if (!sprite) return;

    const update: Record<string, unknown> = {
      status: args.status,
      lastActiveAt: Date.now(),
    };

    if (args.previewUrl !== undefined) {
      update.previewUrl = args.previewUrl;
    }
    if (args.machineId !== undefined) {
      update.machineId = args.machineId;
    }
    if (args.errorMessage !== undefined) {
      update.errorMessage = args.errorMessage;
    }
    if (args.status === "stopped") {
      update.stoppedAt = Date.now();
    }

    await ctx.db.patch("flyioSprites", args.spriteId, update);
  },
});

// Mark Sprite as active (heartbeat)
export const heartbeat = mutation({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const sprite = await ctx.db.get("flyioSprites", args.spriteId);
    if (!sprite || sprite.userId !== userId) return;

    await ctx.db.patch("flyioSprites", args.spriteId, {
      lastActiveAt: Date.now(),
    });
  },
});

// Stop a Sprite
export const stop = mutation({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const sprite = await ctx.db.get("flyioSprites", args.spriteId);
    if (!sprite) throw new Error("Sprite not found");
    if (sprite.userId !== userId) throw new Error("Not authorized");

    if (sprite.status === "stopped" || sprite.status === "stopping") {
      return;
    }

    await ctx.db.patch("flyioSprites", args.spriteId, {
      status: "stopping",
      lastActiveAt: Date.now(),
    });
  },
});

// Delete a Sprite record (after Fly.io app is destroyed)
export const remove = internalMutation({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    await ctx.db.delete("flyioSprites", args.spriteId);
  },
});

// Action to provision Fly.io app
export const provisionFlyioApp = action({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    const sprite = await ctx.runQuery(api.flyioSprites.getById, {
      spriteId: args.spriteId,
    });
    if (!sprite) throw new Error("Sprite not found");

    // Get the Fly.io token from environment
    const flyioToken = process.env.FLYIO_TOKEN;
    if (!flyioToken) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: "Fly.io token not configured. Please set FLYIO_TOKEN environment variable.",
      });
      return;
    }

    // Get repo details
    const repo = await ctx.runQuery(api.projects.get, { repoId: sprite.repoId });
    if (!repo) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: "Repository not found",
      });
      return;
    }

    try {
      // Update status to deploying
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "deploying",
      });

      // Create the Fly.io app
      const createResponse = await fetch("https://api.machines.dev/v1/apps", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${flyioToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_name: sprite.appName,
          org_slug: "personal", // Default to personal org
        }),
      });

      if (!createResponse.ok && createResponse.status !== 409) {
        // 409 means app already exists, which is fine
        const error = await createResponse.text();
        throw new Error(`Failed to create Fly.io app: ${error}`);
      }

      // Create a machine with the app
      const machineConfig = {
        config: {
          image: "node:20-slim",
          env: {
            GITHUB_REPO: `${repo.githubOwner}/${repo.githubRepo}`,
            GITHUB_BRANCH: sprite.branch ?? repo.defaultBranch,
            // External Convex connection if configured
            ...(repo.externalConvexUrl && {
              NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl,
            }),
          },
          services: [
            {
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"] },
              ],
              protocol: "tcp",
              internal_port: 3000,
            },
          ],
          guest: {
            cpu_kind: "shared",
            cpus: 1,
            memory_mb: 512,
          },
          auto_destroy: true,
        },
        region: "ewr", // US East
      };

      const machineResponse = await fetch(
        `https://api.machines.dev/v1/apps/${sprite.appName}/machines`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${flyioToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(machineConfig),
        }
      );

      if (!machineResponse.ok) {
        const error = await machineResponse.text();
        throw new Error(`Failed to create Fly.io machine: ${error}`);
      }

      const machine = await machineResponse.json();
      const previewUrl = `https://${sprite.appName}.fly.dev`;

      // Update status to running
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "running",
        previewUrl,
        machineId: machine.id,
      });
    } catch (error) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});

// Action to stop and destroy Fly.io app
export const destroyFlyioApp = action({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    const sprite = await ctx.runQuery(api.flyioSprites.getById, {
      spriteId: args.spriteId,
    });
    if (!sprite) return;

    const flyioToken = process.env.FLYIO_TOKEN;
    if (!flyioToken) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "stopped",
      });
      return;
    }

    try {
      // Delete the Fly.io app
      const response = await fetch(
        `https://api.machines.dev/v1/apps/${sprite.appName}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${flyioToken}`,
          },
        }
      );

      // 404 means app doesn't exist, which is fine
      if (!response.ok && response.status !== 404) {
        console.error("Failed to delete Fly.io app:", await response.text());
      }
    } catch (error) {
      console.error("Error destroying Fly.io app:", error);
    }

    // Mark as stopped
    await ctx.runMutation(internal.flyioSprites.updateStatus, {
      spriteId: args.spriteId,
      status: "stopped",
    });
  },
});

// Query to get sprite by ID (for actions)
export const getById = query({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args) => {
    return await ctx.db.get("flyioSprites", args.spriteId);
  },
});

// Get all running Sprites for a repo (for cleanup)
export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("flyioSprites")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .collect();
  },
});
