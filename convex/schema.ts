import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userProfiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
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
    runtime: v.optional(v.union(v.literal("docker"), v.literal("webcontainer"), v.literal("flyio-sprite"), v.literal("sandpack"), v.literal("digitalocean-droplet"), v.literal("firecracker"))), // only "docker" is active; others kept for existing DB records
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
    status: v.union(v.literal("provisioning"), v.literal("active"), v.literal("error")),
    errorMessage: v.optional(v.string()),
  })
    .index("by_teamId", ["teamId"])
    .index("by_slug", ["slug"]),

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

    // Repo-specific pool containers (optional - generic pool has no repoId)
    repoId: v.optional(v.id("repos")),
    imageTag: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
    assignedAt: v.optional(v.number()),

    // Error info
    errorMessage: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_status_repoId", ["status", "repoId"])
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

  // Docker container checkpoints (docker commit snapshots) for fast restore
  dockerCheckpoints: defineTable({
    repoId: v.id("repos"),
    branch: v.string(),
    checkpointName: v.string(),
    imageTag: v.optional(v.string()),
    sourceContainerId: v.string(),
    status: v.union(
      v.literal("creating"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("expired")
    ),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_repoId", ["repoId"])
    .index("by_repoId_branch", ["repoId", "branch"])
    .index("by_status", ["status"]),
});
