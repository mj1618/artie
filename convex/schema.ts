import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  userProfiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    githubAccessToken: v.optional(v.string()),
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
  }).index("by_teamId", ["teamId"]),

  sessions: defineTable({
    repoId: v.id("repos"),
    userId: v.string(),
    createdAt: v.number(),
    lastActiveAt: v.number(),
    previewCode: v.optional(v.string()),
    firstMessage: v.optional(v.string()),
    name: v.optional(v.string()),
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
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_messageId", ["messageId"]),
});
