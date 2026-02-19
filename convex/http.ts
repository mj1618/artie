import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";

const http = httpRouter();
auth.addHttpRoutes(http);

// Endpoint for Fly.io sprite containers to report their status
http.route({
  path: "/sprite-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { appName, apiSecret, cloneStatus, error } = body;

      if (!appName || !apiSecret) {
        return new Response(JSON.stringify({ error: "Missing appName or apiSecret" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update the sprite status
      const result = await ctx.runMutation(internal.flyioSprites.updateStatusFromContainer, {
        appName,
        apiSecret,
        cloneStatus,
        errorMessage: error ?? undefined,
      });

      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[sprite-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Endpoint for DigitalOcean droplet containers to report their status
// More rigorous than sprite-status with better validation
http.route({
  path: "/droplet-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { dropletName, apiSecret, status, error } = body;

      console.log(`[droplet-status] Received: dropletName=${dropletName}, status=${status}, secretPrefix=${apiSecret?.slice(0, 8)}...`);

      // Validate required fields
      if (!dropletName || typeof dropletName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid dropletName" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!apiSecret || typeof apiSecret !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid apiSecret" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Validate status
      const validStatuses = ["cloning", "installing", "ready", "failed"];
      if (!status || !validStatuses.includes(status)) {
        return new Response(
          JSON.stringify({
            error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Update the droplet status
      const result = await ctx.runMutation(
        internal.droplets.updateStatusFromContainer,
        {
          dropletName,
          apiSecret,
          status,
          errorMessage: error ?? undefined,
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
      console.error("[droplet-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Endpoint for Firecracker host to report VM status updates
http.route({
  path: "/firecracker-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { vmName, callbackSecret, status, error } = body;

      console.log(
        `[firecracker-status] Received: vmName=${vmName}, status=${status}`
      );

      if (!vmName || typeof vmName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid vmName" }),
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
        internal.firecrackerVms.updateStatusFromHost,
        {
          vmName,
          apiSecret: callbackSecret,
          status,
          errorMessage: error ?? undefined,
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
      console.error("[firecracker-status] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Endpoint for Firecracker host to report snapshot creation
http.route({
  path: "/firecracker-snapshot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const {
        vmName,
        callbackSecret,
        owner,
        repo,
        branch,
        commitSha,
        sizeBytes,
        status,
        error,
      } = body;

      console.log(
        `[firecracker-snapshot] Received: ${owner}/${repo}@${branch} status=${status}`
      );

      // Validate required fields
      if (!vmName || !callbackSecret || !owner || !repo || !branch) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Look up the VM to validate the callback secret and get repoId/userId
      const vms = await ctx.runQuery(internal.firecrackerVms.getByVmName, {
        vmName,
      });

      const vm = vms?.find((v: { apiSecret: string }) => v.apiSecret === callbackSecret);
      if (!vm) {
        return new Response(
          JSON.stringify({ error: "Invalid vmName or secret" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      if (status === "created" || status === "ready") {
        // Record the snapshot
        await ctx.runMutation(internal.firecrackerVms.recordSnapshot, {
          repoId: vm.repoId,
          branch,
          commitSha: commitSha || "unknown",
          sizeBytes: sizeBytes || 0,
          createdBy: vm.userId,
        });
      } else if (status === "used") {
        // Record snapshot usage for analytics
        const snapshot = await ctx.runQuery(internal.firecrackerVms.getSnapshot, {
          repoId: vm.repoId,
          branch,
        });
        if (snapshot) {
          await ctx.runMutation(internal.firecrackerVms.recordSnapshotUsage, {
            snapshotId: snapshot._id,
          });
        }
        console.log(`[firecracker-snapshot] Recorded usage for ${owner}/${repo}@${branch}`);
      } else if (status === "failed") {
        // Mark snapshot as failed
        await ctx.runMutation(internal.firecrackerVms.markSnapshotFailed, {
          repoId: vm.repoId,
          branch,
          errorMessage: error || "Unknown error",
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[firecracker-snapshot] Error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

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

export default http;
