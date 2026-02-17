import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  userProfiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    githubAccessToken: v.optional(v.string()),
    githubRefreshToken: v.optional(v.string()),
    githubTokenExpiresAt: v.optional(v.number()),
    githubUsername: v.optional(v.string()),
  }).index("by_userId", ["userId"]),

  teams: defineTable({
    name: v.string(),
    ownerId: v.string(),
    llmProvider: v.optional(v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google"))),
    llmApiKey: v.optional(v.string()),
    llmModel: v.optional(v.string()),
  }).index("by_ownerId", ["ownerId"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    invitedAt: v.number(),
    joinedAt: v.optional(v.number()),
  })
    .index("by_teamId", ["teamId"])
    .index("by_userId", ["userId"])
    .index("by_teamId_userId", ["teamId", "userId"]),

  invites: defineTable({
    teamId: v.id("teams"),
    email: v.string(),
    invitedBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_teamId", ["teamId"])
    .index("by_email", ["email"]),

  repos: defineTable({
    teamId: v.id("teams"),
    githubOwner: v.string(),
    githubRepo: v.string(),
    githubUrl: v.string(),
    defaultBranch: v.string(),
    pushStrategy: v.union(v.literal("direct"), v.literal("pr")),
    connectedBy: v.string(),
    connectedAt: v.number(),
    runtime: v.optional(v.union(v.literal("webcontainer"), v.literal("flyio-sprite"), v.literal("sandpack"), v.literal("digitalocean-droplet"))),
    hasConvex: v.optional(v.boolean()),
    projectType: v.optional(v.string()),
    externalConvexUrl: v.optional(v.string()),
    externalConvexDeployment: v.optional(v.string()),
  }).index("by_teamId", ["teamId"]),

  sessions: defineTable({
    repoId: v.id("repos"),
    userId: v.string(),
    createdAt: v.number(),
    lastActiveAt: v.number(),
    previewCode: v.optional(v.string()),
    firstMessage: v.optional(v.string()),
    name: v.optional(v.string()),
    branchName: v.optional(v.string()),
    featureName: v.optional(v.string()),
  })
    .index("by_repoId", ["repoId"])
    .index("by_userId", ["userId"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
    streaming: v.optional(v.boolean()),
    changes: v.optional(
      v.object({
        files: v.array(v.string()),
        committed: v.boolean(),
        commitSha: v.optional(v.string()),
        prUrl: v.optional(v.string()),
      }),
    ),
  }).index("by_sessionId", ["sessionId"]),

  fileChanges: defineTable({
    sessionId: v.id("sessions"),
    messageId: v.id("messages"),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
        originalContent: v.optional(v.string()),
      }),
    ),
    applied: v.boolean(),
    reverted: v.optional(v.boolean()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_messageId", ["messageId"]),

  bashCommands: defineTable({
    sessionId: v.id("sessions"),
    messageId: v.id("messages"),
    command: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    output: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_messageId", ["messageId"])
    .index("by_status", ["status"]),

  templateProjects: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    slug: v.string(),
    template: v.literal("nextjs-convex"),
    createdBy: v.string(),
    createdAt: v.number(),
    convexProjectId: v.string(),
    convexDeploymentUrl: v.string(),
    convexDeployKey: v.string(),
    flyioAppName: v.string(),
    flyioDeployKey: v.string(),
    status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("error")),
    errorMessage: v.optional(v.string()),
  })
    .index("by_teamId", ["teamId"])
    .index("by_slug", ["slug"]),

  flyioDeployKeys: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    name: v.string(),
    encryptedKey: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_teamId", ["teamId"])
    .index("by_userId", ["userId"]),

  // Fly.io Sprites - ephemeral Fly.io apps for server-side previews
  flyioSprites: defineTable({
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    userId: v.string(),
    // Fly.io app name (unique identifier)
    appName: v.string(),
    // App status
    status: v.union(
      v.literal("provisioning"),
      v.literal("deploying"),
      v.literal("running"),
      v.literal("stopping"),
      v.literal("stopped"),
      v.literal("error")
    ),
    // Public URL for the preview
    previewUrl: v.optional(v.string()),
    // Internal API URL for file operations (e.g., http://[app].internal:3001)
    apiUrl: v.optional(v.string()),
    // Secret for API authentication
    apiSecret: v.optional(v.string()),
    // Clone status: tracks whether the repo has been cloned and deps installed
    cloneStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("cloning"),
        v.literal("installing"),
        v.literal("ready"),
        v.literal("failed")
      )
    ),
    // Fly.io machine ID
    machineId: v.optional(v.string()),
    // Error message if status is error
    errorMessage: v.optional(v.string()),
    // Git branch being previewed
    branch: v.optional(v.string()),
    // Timestamps
    createdAt: v.number(),
    lastActiveAt: v.number(),
    stoppedAt: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_repoId", ["repoId"])
    .index("by_appName", ["appName"])
    .index("by_status", ["status"]),

  // DigitalOcean Droplets - ephemeral VMs for server-side previews
  // More rigorous state management than Fly.io sprites
  droplets: defineTable({
    // Identifiers
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    teamId: v.id("teams"),
    userId: v.string(),

    // DigitalOcean metadata
    dropletId: v.optional(v.string()), // DO droplet ID
    dropletName: v.string(), // Unique name
    ipv4Address: v.optional(v.string()),
    region: v.string(),
    size: v.string(),

    // Single unified status field (state machine)
    status: v.union(
      v.literal("requested"), // DB record created, waiting for scheduler
      v.literal("creating"), // DO API call in progress
      v.literal("create_failed"), // DO API failed (will retry)
      v.literal("provisioning"), // Droplet created, waiting for active
      v.literal("booting"), // Droplet active, container starting
      v.literal("cloning"), // Cloning repository
      v.literal("installing"), // Installing dependencies
      v.literal("ready"), // Ready but no recent heartbeat
      v.literal("active"), // Ready with recent heartbeat
      v.literal("stopping"), // Stop requested
      v.literal("destroying"), // DO deletion in progress
      v.literal("destroyed"), // Fully cleaned up
      v.literal("unhealthy") // Health check failed, pending cleanup
    ),

    // URLs & auth
    previewUrl: v.optional(v.string()),
    apiUrl: v.optional(v.string()),
    apiSecret: v.string(), // Use crypto.randomUUID()

    // Error handling
    errorMessage: v.optional(v.string()),
    retryCount: v.number(),
    lastRetryAt: v.optional(v.number()),

    // Timestamps for lifecycle management
    createdAt: v.number(),
    statusChangedAt: v.number(), // When status last changed
    lastHeartbeatAt: v.optional(v.number()),
    lastHealthCheckAt: v.optional(v.number()),
    destroyedAt: v.optional(v.number()),

    // Audit trail
    statusHistory: v.array(
      v.object({
        status: v.string(),
        timestamp: v.number(),
        reason: v.optional(v.string()),
      })
    ),

    // Repository context
    branch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_teamId", ["teamId"])
    .index("by_dropletId", ["dropletId"])
    .index("by_dropletName", ["dropletName"])
    .index("by_status", ["status"])
    .index("by_status_and_statusChangedAt", ["status", "statusChangedAt"]),

  // Droplet quotas per team
  dropletQuotas: defineTable({
    teamId: v.id("teams"),
    maxDroplets: v.number(), // Default: 5
    currentActive: v.number(),
    lastUpdatedAt: v.number(),
  }).index("by_teamId", ["teamId"]),
});
