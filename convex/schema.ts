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

  inviteLinks: defineTable({
    teamId: v.id("teams"),
    code: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_teamId", ["teamId"]),

  repos: defineTable({
    teamId: v.id("teams"),
    githubOwner: v.string(),
    githubRepo: v.string(),
    githubUrl: v.string(),
    defaultBranch: v.string(),
    pushStrategy: v.union(v.literal("direct"), v.literal("pr")),
    connectedBy: v.string(),
    connectedAt: v.number(),
    runtime: v.optional(v.union(v.literal("webcontainer"), v.literal("flyio-sprite"), v.literal("sandpack"), v.literal("digitalocean-droplet"), v.literal("firecracker"), v.literal("docker"))),
    hasConvex: v.optional(v.boolean()),
    projectType: v.optional(v.string()),
    externalConvexUrl: v.optional(v.string()),
    externalConvexDeployment: v.optional(v.string()),
    envVars: v.optional(v.array(v.object({
      key: v.string(),
      value: v.string(),
    }))),
    customPrompt: v.optional(v.string()),
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
    stopRequested: v.optional(v.boolean()),
  })
    .index("by_repoId", ["repoId"])
    .index("by_userId", ["userId"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
    streaming: v.optional(v.boolean()),
    rawOutput: v.optional(v.string()),
    imageIds: v.optional(v.array(v.id("_storage"))),
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

  // Firecracker VMs - fast-booting microVMs for server-side previews
  firecrackerVms: defineTable({
    // Identifiers
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    teamId: v.id("teams"),
    userId: v.string(),

    // VM metadata (assigned by host API)
    vmId: v.optional(v.string()),
    vmName: v.string(),
    vmIp: v.optional(v.string()),

    // Port mapping (from host API response)
    hostPort: v.optional(v.number()),

    // Constructed URLs
    previewUrl: v.optional(v.string()),
    logsUrl: v.optional(v.string()),
    terminalUrl: v.optional(v.string()),

    // State machine
    status: v.union(
      v.literal("requested"),
      v.literal("creating"),
      v.literal("booting"),
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("starting"),
      v.literal("ready"),
      v.literal("active"),
      v.literal("stopping"),
      v.literal("destroying"),
      v.literal("destroyed"),
      v.literal("unhealthy")
    ),

    // Authentication
    apiSecret: v.string(),

    // Error handling
    errorMessage: v.optional(v.string()),
    retryCount: v.number(),
    lastRetryAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    statusChangedAt: v.number(),
    lastHeartbeatAt: v.optional(v.number()),
    destroyedAt: v.optional(v.number()),

    // Audit trail
    statusHistory: v.array(v.object({
      status: v.string(),
      timestamp: v.number(),
      reason: v.optional(v.string()),
    })),

    // Repository context
    branch: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_teamId", ["teamId"])
    .index("by_vmId", ["vmId"])
    .index("by_vmName", ["vmName"])
    .index("by_status", ["status"])
    .index("by_status_and_statusChangedAt", ["status", "statusChangedAt"]),

  // Per-repository VM snapshots for faster subsequent provisioning
  // After initial clone + install, we snapshot the VM state
  // Future VMs for the same repo can restore from snapshot instead of full setup
  repoSnapshots: defineTable({
    repoId: v.id("repos"),
    branch: v.string(),
    commitSha: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
    sizeBytes: v.number(),
    status: v.union(
      v.literal("creating"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("expired")
    ),
    errorMessage: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_status", ["status"]),

  // Pre-warmed VM pool for instant provisioning
  // Pool VMs are created in advance and assigned to sessions on-demand
  firecrackerVmPool: defineTable({
    // Host VM metadata (assigned by host API when created)
    vmId: v.string(),
    vmName: v.string(),
    vmIp: v.string(),
    hostPort: v.number(),

    // Pool status
    status: v.union(
      v.literal("creating"),     // Being created on host
      v.literal("ready"),        // Booted and waiting for assignment
      v.literal("assigned"),     // Assigned to a session (transitioning to firecrackerVms)
      v.literal("failed"),       // Creation failed
      v.literal("destroying")    // Being cleaned up
    ),

    // Timestamps
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
    assignedAt: v.optional(v.number()),

    // Error info
    errorMessage: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_vmId", ["vmId"])
    .index("by_vmName", ["vmName"]),

  // Docker Containers - containers running on DigitalOcean Docker host
  dockerContainers: defineTable({
    // Identifiers
    sessionId: v.id("sessions"),
    repoId: v.id("repos"),
    teamId: v.id("teams"),
    userId: v.string(),

    // Container metadata (assigned by host API)
    containerId: v.optional(v.string()),
    containerName: v.string(),

    // Port mapping (from host API response)
    hostPort: v.optional(v.number()),

    // Constructed URLs
    previewUrl: v.optional(v.string()),
    logsUrl: v.optional(v.string()),
    terminalUrl: v.optional(v.string()),

    // State machine
    status: v.union(
      v.literal("requested"),
      v.literal("creating"),
      v.literal("cloning"),
      v.literal("installing"),
      v.literal("starting"),
      v.literal("ready"),
      v.literal("active"),
      v.literal("stopping"),
      v.literal("destroying"),
      v.literal("destroyed"),
      v.literal("unhealthy")
    ),

    // Authentication
    apiSecret: v.string(),

    // Error handling
    errorMessage: v.optional(v.string()),
    buildLog: v.optional(v.string()),
    retryCount: v.number(),
    lastRetryAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    statusChangedAt: v.number(),
    lastHeartbeatAt: v.optional(v.number()),
    destroyedAt: v.optional(v.number()),

    // Audit trail
    statusHistory: v.array(v.object({
      status: v.string(),
      timestamp: v.number(),
      reason: v.optional(v.string()),
    })),

    // Repository context
    branch: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_teamId", ["teamId"])
    .index("by_containerId", ["containerId"])
    .index("by_containerName", ["containerName"])
    .index("by_status", ["status"])
    .index("by_status_and_statusChangedAt", ["status", "statusChangedAt"]),

  // Pre-warmed Docker container pool for instant provisioning
  dockerContainerPool: defineTable({
    // Container metadata (assigned by host API when created)
    containerId: v.string(),
    containerName: v.string(),
    hostPort: v.number(),

    // Pool status
    status: v.union(
      v.literal("creating"),
      v.literal("ready"),
      v.literal("assigned"),
      v.literal("failed"),
      v.literal("destroying")
    ),

    // Timestamps
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
    assignedAt: v.optional(v.number()),

    // Error info
    errorMessage: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_containerId", ["containerId"])
    .index("by_containerName", ["containerName"]),

  // Prebuilt Docker images for repos (main branch images)
  dockerRepoImages: defineTable({
    repoId: v.id("repos"),
    branch: v.string(),
    imageTag: v.string(),
    commitSha: v.string(),
    status: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("failed")
    ),
    sizeBytes: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.string(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_imageTag", ["imageTag"])
    .index("by_status", ["status"]),
});
