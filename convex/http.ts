import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Endpoint for Docker host to report container status updates
http.route({
  path: "/docker-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { containerName, callbackSecret, status, error, buildLog } = body;

      console.log(
        `[docker-status] Received: containerName=${containerName}, status=${status}${buildLog ? `, buildLog=${buildLog.length} chars` : ""}`
      );

      if (!containerName || typeof containerName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid containerName" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (!callbackSecret || typeof callbackSecret !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid callbackSecret" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const validStatuses = ["cloning", "installing", "starting", "ready", "failed"];
      if (!status || !validStatuses.includes(status)) {
        return new Response(
          JSON.stringify({
            error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await ctx.runMutation(
        internal.dockerContainers.updateStatusFromHost,
        {
          containerName,
          apiSecret: callbackSecret,
          status,
          errorMessage: error ?? undefined,
          buildLog: typeof buildLog === "string" ? buildLog.slice(0, 32000) : undefined,
        }
      );

      if (!result.success) {
        const statusCode = result.error === "Invalid secret" ? 401 : 404;
        return new Response(JSON.stringify({ error: result.error }), {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[docker-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Endpoint for Docker host to report repo image build status
http.route({
  path: "/docker-image-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const {
        containerName,
        callbackSecret,
        owner,
        repo,
        branch,
        imageTag,
        commitSha,
        sizeBytes,
        status,
        error,
      } = body;

      console.log(
        `[docker-image-status] Received: ${owner}/${repo}@${branch} status=${status}`
      );

      if (!containerName || !callbackSecret || !owner || !repo || !branch) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Look up the container to validate the callback secret and get repoId/userId
      const containers = await ctx.runQuery(internal.dockerContainers.getByContainerName, {
        containerName,
      });

      const container = containers?.find((c: { apiSecret: string }) => c.apiSecret === callbackSecret);
      if (!container) {
        return new Response(
          JSON.stringify({ error: "Invalid containerName or secret" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      if (status === "created" || status === "ready") {
        await ctx.runMutation(internal.dockerContainers.recordRepoImage, {
          repoId: container.repoId,
          branch,
          imageTag: imageTag || `${owner}-${repo}:main`,
          commitSha: commitSha || "unknown",
          sizeBytes: sizeBytes || 0,
          createdBy: container.userId,
        });
        console.log(`[docker-image-status] Recorded image for ${owner}/${repo}@${branch}`);
      } else if (status === "used") {
        const repoImage = await ctx.runQuery(internal.dockerContainers.getRepoImage, {
          repoId: container.repoId,
        });
        if (repoImage) {
          await ctx.runMutation(internal.dockerContainers.recordRepoImageUsage, {
            imageId: repoImage._id,
          });
        }
        console.log(`[docker-image-status] Recorded usage for ${owner}/${repo}@${branch}`);
      } else if (status === "failed") {
        await ctx.runMutation(internal.dockerContainers.markRepoImageFailed, {
          repoId: container.repoId,
          branch,
          errorMessage: error || "Unknown error",
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[docker-image-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Endpoint for Docker host to report checkpoint creation status
http.route({
  path: "/docker-checkpoint-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { callbackSecret, checkpointName, containerId, imageTag, status, error } = body;

      console.log(
        `[docker-checkpoint-status] Received: checkpoint=${checkpointName}, status=${status}, imageTag=${imageTag}`
      );

      const apiSecret = process.env.DOCKER_API_SECRET;
      if (!apiSecret || callbackSecret !== apiSecret) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      // Find the container to get repoId and branch
      const container = await ctx.runQuery(
        internal.dockerContainers.getByContainerId,
        { containerId }
      );
      if (!container) {
        console.warn(`[docker-checkpoint-status] No container found for ${containerId}`);
        return new Response(
          JSON.stringify({ error: "Container not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      await ctx.runMutation(internal.dockerCheckpoints.recordCheckpoint, {
        repoId: container.repoId,
        branch: container.branch || "main",
        checkpointName,
        imageTag: typeof imageTag === "string" ? imageTag : undefined,
        sourceContainerId: containerId,
        status: status === "ready" ? "ready" : "failed",
        errorMessage: error,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[docker-checkpoint-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
