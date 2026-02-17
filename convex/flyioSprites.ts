import { query, mutation, action, internalMutation, ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Refresh GitHub access token using refresh token.
 */
async function refreshGithubToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshGithubToken] Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET");
    return null;
  }

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("[refreshGithubToken] GitHub error:", data.error, data.error_description);
      return null;
    }

    if (!data.access_token) {
      console.error("[refreshGithubToken] No access_token in response");
      return null;
    }

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: expiresAt ?? Date.now() + 8 * 60 * 60 * 1000,
    };
  } catch (err) {
    console.error("[refreshGithubToken] Failed to refresh token:", err);
    return null;
  }
}

/**
 * Get the user's GitHub token, refreshing if expired.
 * Throws an error if token refresh fails.
 */
async function getUserGithubToken(ctx: ActionCtx): Promise<string | undefined> {
  const profile = await ctx.runQuery(api.users.getProfile);

  if (!profile?.githubAccessToken) {
    return undefined;
  }

  const expiresAt = profile.githubTokenExpiresAt;
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    console.log("[getUserGithubToken] Token expired or expiring soon, attempting refresh");

    if (!profile.githubRefreshToken) {
      throw new Error(
        "Your GitHub connection has expired. Please reconnect your GitHub account in Settings.",
      );
    }

    const newTokens = await refreshGithubToken(profile.githubRefreshToken);

    if (!newTokens) {
      await ctx.runMutation(api.users.disconnectGithub);
      throw new Error(
        "Your GitHub connection has expired and could not be refreshed. Please reconnect your GitHub account in Settings.",
      );
    }

    await ctx.runMutation(api.users.updateGithubTokens, {
      githubAccessToken: newTokens.accessToken,
      githubRefreshToken: newTokens.refreshToken,
      githubTokenExpiresAt: newTokens.expiresAt,
    });

    return newTokens.accessToken;
  }

  return profile.githubAccessToken;
}

// Docker image for Sprite containers (hosted on Fly.io registry)
// Use digest for reliability - update this after rebuilding the image with `fly deploy --remote-only`
const SPRITE_IMAGE =
  process.env.SPRITE_IMAGE ||
  "registry.fly.io/artie-sprite-base@sha256:3f150fe46c3916c15e09b61924e033f040a54d3879fba3bcd35b0b2a7ed42aa5";

// Generate a random secret for API authentication (using Math.random is sufficient for this use case)
function generateApiSecret(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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
        // Regenerate apiSecret if missing (handles legacy records)
        const apiSecret = existing.apiSecret || generateApiSecret();
        await ctx.db.patch("flyioSprites", existing._id, {
          status: "provisioning",
          lastActiveAt: Date.now(),
          stoppedAt: undefined,
          errorMessage: undefined,
          apiSecret,
        });
        return existing._id;
      }
      // If error, allow retry
      if (existing.status === "error") {
        // Regenerate apiSecret if missing (handles legacy records)
        const apiSecret = existing.apiSecret || generateApiSecret();
        await ctx.db.patch("flyioSprites", existing._id, {
          status: "provisioning",
          lastActiveAt: Date.now(),
          errorMessage: undefined,
          apiSecret,
        });
        return existing._id;
      }
      // Otherwise return existing
      return existing._id;
    }

    // Create new Sprite record
    const appName = generateAppName(repo.githubRepo, args.sessionId);
    const apiSecret = generateApiSecret();
    const spriteId = await ctx.db.insert("flyioSprites", {
      sessionId: args.sessionId,
      repoId: session.repoId,
      userId,
      appName,
      status: "provisioning",
      branch: args.branch ?? repo.defaultBranch,
      apiSecret,
      cloneStatus: "pending",
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
    apiUrl: v.optional(v.string()),
    machineId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    cloneStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("cloning"),
        v.literal("installing"),
        v.literal("ready"),
        v.literal("failed")
      )
    ),
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
    if (args.apiUrl !== undefined) {
      update.apiUrl = args.apiUrl;
    }
    if (args.machineId !== undefined) {
      update.machineId = args.machineId;
    }
    if (args.errorMessage !== undefined) {
      update.errorMessage = args.errorMessage;
    }
    if (args.cloneStatus !== undefined) {
      update.cloneStatus = args.cloneStatus;
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

    // Get user's GitHub token for cloning (with auto-refresh)
    let githubToken: string | undefined;
    try {
      githubToken = await getUserGithubToken(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub token error";
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: message,
      });
      return;
    }
    if (!githubToken) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: "GitHub token not available. Please connect your GitHub account in Settings.",
      });
      return;
    }

    // Ensure apiSecret is set
    if (!sprite.apiSecret) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: "API secret missing. Please stop and restart the sprite.",
      });
      return;
    }

    try {
      // Log environment info for debugging
      console.log("[provisionFlyioApp] CONVEX_SITE_URL:", process.env.CONVEX_SITE_URL);

      // Update status to deploying
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "deploying",
        cloneStatus: "pending",
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

      if (!createResponse.ok) {
        // 409 or 422 with "already been taken" means app already exists, which is fine
        const error = await createResponse.text();
        const isAlreadyExists =
          createResponse.status === 409 ||
          (createResponse.status === 422 && error.includes("already been taken"));
        if (!isAlreadyExists) {
          throw new Error(`Failed to create Fly.io app: ${error}`);
        }
      }

      // Allocate IP addresses for the app (required for public access)
      // Must use GraphQL API - Machines API doesn't have IP allocation endpoint
      const graphqlEndpoint = "https://api.fly.io/graphql";

      // Allocate shared IPv4
      const ipv4Query = `
        mutation($input: AllocateIPAddressInput!) {
          allocateIpAddress(input: $input) {
            ipAddress {
              id
              address
              type
            }
          }
        }
      `;
      const ipv4Response = await fetch(graphqlEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${flyioToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ipv4Query,
          variables: {
            input: {
              appId: sprite.appName,
              type: "shared_v4",
            },
          },
        }),
      });
      if (ipv4Response.ok) {
        const ipv4Data = await ipv4Response.json();
        if (ipv4Data.errors) {
          // Ignore "already allocated" errors
          const errorMsg = JSON.stringify(ipv4Data.errors);
          if (!errorMsg.includes("already") && !errorMsg.includes("exists")) {
            console.warn(`Failed to allocate IPv4: ${errorMsg}`);
          }
        } else {
          console.log(`Allocated IPv4 for ${sprite.appName}`);
        }
      } else {
        console.warn(`IPv4 allocation request failed: ${ipv4Response.status}`);
      }

      // Allocate IPv6
      const ipv6Query = `
        mutation($input: AllocateIPAddressInput!) {
          allocateIpAddress(input: $input) {
            ipAddress {
              id
              address
              type
            }
          }
        }
      `;
      const ipv6Response = await fetch(graphqlEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${flyioToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ipv6Query,
          variables: {
            input: {
              appId: sprite.appName,
              type: "v6",
            },
          },
        }),
      });
      if (ipv6Response.ok) {
        const ipv6Data = await ipv6Response.json();
        if (ipv6Data.errors) {
          const errorMsg = JSON.stringify(ipv6Data.errors);
          if (!errorMsg.includes("already") && !errorMsg.includes("exists")) {
            console.warn(`Failed to allocate IPv6: ${errorMsg}`);
          }
        } else {
          console.log(`Allocated IPv6 for ${sprite.appName}`);
        }
      } else {
        console.warn(`IPv6 allocation request failed: ${ipv6Response.status}`);
      }

      // Create a machine with the custom Sprite image
      const machineConfig = {
        config: {
          image: SPRITE_IMAGE,
          init: {
            cmd: ["/app/entrypoint.sh"],
          },
          env: {
            GITHUB_REPO: `${repo.githubOwner}/${repo.githubRepo}`,
            GITHUB_BRANCH: sprite.branch ?? repo.defaultBranch,
            GITHUB_TOKEN: githubToken,
            API_SECRET: sprite.apiSecret,
            API_PORT: "3001",
            PROJECT_DIR: "/app/project",
            // For status reporting back to Convex
            APP_NAME: sprite.appName,
            // Hardcode for now - process.env.CONVEX_SITE_URL may not be available in actions
            CONVEX_SITE_URL: process.env.CONVEX_SITE_URL || "https://ceaseless-hornet-54.convex.site",
            // External Convex connection if configured
            ...(repo.externalConvexUrl && {
              NEXT_PUBLIC_CONVEX_URL: repo.externalConvexUrl,
            }),
          },
          services: [
            // Dev server (public on 443/80)
            {
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"] },
              ],
              protocol: "tcp",
              internal_port: 3000,
            },
            // API server (public on 8443 with TLS)
            {
              ports: [
                { port: 8443, handlers: ["tls", "http"] },
              ],
              protocol: "tcp",
              internal_port: 3001,
            },
          ],
          guest: {
            cpu_kind: "shared",
            cpus: 2,
            memory_mb: 2048, // More memory speeds up pnpm install significantly
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
      // Public API URL on port 8443 with TLS
      const apiUrl = `https://${sprite.appName}.fly.dev:8443`;

      // Update status to running
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "running",
        previewUrl,
        apiUrl,
        machineId: machine.id,
        cloneStatus: "cloning", // Container is starting, will clone on boot
      });
    } catch (error) {
      await ctx.runMutation(internal.flyioSprites.updateStatus, {
        spriteId: args.spriteId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        cloneStatus: "failed",
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

// Internal mutation to update clone status only
export const updateCloneStatus = internalMutation({
  args: {
    spriteId: v.id("flyioSprites"),
    cloneStatus: v.union(
      v.literal("pending"),
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sprite = await ctx.db.get("flyioSprites", args.spriteId);
    if (!sprite) return;

    const update: Record<string, unknown> = {
      cloneStatus: args.cloneStatus,
      lastActiveAt: Date.now(),
    };

    if (args.errorMessage !== undefined) {
      update.errorMessage = args.errorMessage;
    }

    await ctx.db.patch("flyioSprites", args.spriteId, update);
  },
});

// Action to check if the Sprite container is ready (clone complete, deps installed)
export const checkSpriteReady = action({
  args: { spriteId: v.id("flyioSprites") },
  handler: async (ctx, args): Promise<{ ready: boolean; status: string }> => {
    const sprite = await ctx.runQuery(api.flyioSprites.getById, {
      spriteId: args.spriteId,
    });

    if (!sprite || !sprite.apiUrl || !sprite.apiSecret) {
      return { ready: false, status: "not_provisioned" };
    }

    try {
      // Check the container's clone status endpoint
      const response = await fetch(`${sprite.apiUrl}/clone-status`, {
        headers: {
          Authorization: `Bearer ${sprite.apiSecret}`,
        },
      });

      if (!response.ok) {
        return { ready: false, status: "api_error" };
      }

      const data = await response.json();

      if (data.status === "ready" && sprite.cloneStatus !== "ready") {
        await ctx.runMutation(internal.flyioSprites.updateCloneStatus, {
          spriteId: args.spriteId,
          cloneStatus: "ready",
        });
      }

      return {
        ready: data.status === "ready",
        status: data.status,
      };
    } catch (error) {
      console.error("[checkSpriteReady] Failed to check container status:", error);
      return { ready: false, status: "connection_error" };
    }
  },
});

// Internal mutation for container to report its status via HTTP endpoint
export const updateStatusFromContainer = internalMutation({
  args: {
    appName: v.string(),
    apiSecret: v.string(),
    cloneStatus: v.union(
      v.literal("pending"),
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    // Find sprite by appName
    const sprite = await ctx.db
      .query("flyioSprites")
      .withIndex("by_appName", (q) => q.eq("appName", args.appName))
      .first();

    if (!sprite) {
      return { success: false, error: "Sprite not found" };
    }

    // Verify the secret matches
    if (sprite.apiSecret !== args.apiSecret) {
      return { success: false, error: "Invalid secret" };
    }

    // Update the status
    const update: Record<string, unknown> = {
      cloneStatus: args.cloneStatus,
      lastActiveAt: Date.now(),
    };

    if (args.errorMessage !== undefined) {
      update.errorMessage = args.errorMessage;
    }

    // If failed, also set the main status to error
    if (args.cloneStatus === "failed") {
      update.status = "error";
    }

    await ctx.db.patch("flyioSprites", sprite._id, update);
    return { success: true };
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
