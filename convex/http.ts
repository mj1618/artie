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
        errorMessage: error,
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
          errorMessage: error,
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

export default http;
