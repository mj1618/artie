import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";

export const listMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const teams = await Promise.all(
      memberships.map((m) => ctx.db.get("teams", m.teamId)),
    );
    return teams.filter((t) => t !== null);
  },
});

export const getTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", args.teamId).eq("userId", userId),
      )
      .unique();
    if (!membership) return null;
    const team = await ctx.db.get("teams", args.teamId);
    return team ? { ...team, myRole: membership.role } : null;
  },
});

export const listMembers = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", args.teamId).eq("userId", userId),
      )
      .unique();
    if (!membership) return [];
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
    const resolved = await Promise.all(
      members.map(async (m) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", m.userId))
          .unique();
        return { ...m, name: profile?.displayName, email: profile?.email };
      }),
    );
    return resolved;
  },
});

export const listInvites = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) return [];
    return await ctx.db
      .query("invites")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const inviteMember = mutation({
  args: { teamId: v.id("teams"), email: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    const existing = await ctx.db
      .query("invites")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .filter((q) => q.eq(q.field("email"), args.email))
      .unique();
    if (existing) throw new Error("Already invited");
    return await ctx.db.insert("invites", {
      teamId: args.teamId,
      email: args.email,
      invitedBy: userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
  },
});

export const removeMember = mutation({
  args: { teamId: v.id("teams"), memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member || member.teamId !== args.teamId)
      throw new Error("Member not found");
    if (member.role === "owner") throw new Error("Cannot remove the owner");
    await ctx.db.delete("teamMembers", args.memberId);
  },
});

export const cancelInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");
    const team = await ctx.db.get("teams", invite.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("invites", args.inviteId);
  },
});

export const listMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const email = identity.email;
    if (!email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    const now = Date.now();
    const resolved = await Promise.all(
      invites
        .filter((inv) => inv.expiresAt > now)
        .map(async (inv) => {
          const team = await ctx.db.get("teams", inv.teamId);
          return {
            ...inv,
            teamName: team?.name ?? "Unknown Team",
          };
        }),
    );
    return resolved;
  },
});

export const acceptInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");

    if (invite.expiresAt < Date.now()) {
      await ctx.db.delete("invites", args.inviteId);
      throw new Error("Invite has expired");
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.email !== invite.email) {
      throw new Error("This invite is for a different email address");
    }

    const existingMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", invite.teamId).eq("userId", userId),
      )
      .unique();
    if (existingMembership) {
      await ctx.db.delete("invites", args.inviteId);
      throw new Error("You are already a member of this team");
    }

    await ctx.db.insert("teamMembers", {
      teamId: invite.teamId,
      userId,
      role: "member",
      invitedAt: invite.createdAt,
      joinedAt: Date.now(),
    });

    await ctx.db.delete("invites", args.inviteId);

    return invite.teamId;
  },
});

export const declineInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invite = await ctx.db.get("invites", args.inviteId);
    if (!invite) throw new Error("Invite not found");

    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.email !== invite.email) {
      throw new Error("This invite is for a different email address");
    }

    await ctx.db.delete("invites", args.inviteId);
  },
});

export const createTeam = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const teamId = await ctx.db.insert("teams", {
      name: args.name,
      ownerId: userId,
    });
    await ctx.db.insert("teamMembers", {
      teamId,
      userId,
      role: "owner",
      invitedAt: Date.now(),
      joinedAt: Date.now(),
    });
    return teamId;
  },
});

export const getLlmSettings = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) return null;
    return {
      llmProvider: team.llmProvider ?? null,
      llmModel: team.llmModel ?? null,
      hasApiKey: !!(team.llmApiKey && team.llmApiKey.length > 0),
    };
  },
});

export const updateLlmSettings = mutation({
  args: {
    teamId: v.id("teams"),
    llmProvider: v.optional(v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google"))),
    llmApiKey: v.optional(v.string()),
    llmModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    const updates: Record<string, string | undefined> = {};
    if (args.llmProvider !== undefined) updates.llmProvider = args.llmProvider || undefined;
    if (args.llmApiKey !== undefined) updates.llmApiKey = args.llmApiKey || undefined;
    if (args.llmModel !== undefined) updates.llmModel = args.llmModel || undefined;

    // If provider is being cleared, clear everything
    if (!args.llmProvider) {
      updates.llmProvider = undefined;
      updates.llmApiKey = undefined;
      updates.llmModel = undefined;
    }

    await ctx.db.patch("teams", args.teamId, updates);
  },
});

export const getTeamInternal = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    return await ctx.db.get("teams", args.teamId);
  },
});

// --- Invite Link functions ---

export const createInviteLink = mutation({
  args: {
    teamId: v.id("teams"),
    expiresAt: v.optional(v.number()),
    maxUses: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");

    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    await ctx.db.insert("inviteLinks", {
      teamId: args.teamId,
      code,
      createdBy: userId,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      maxUses: args.maxUses,
      useCount: 0,
    });

    return code;
  },
});

export const getInviteByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const inviteLink = await ctx.db
      .query("inviteLinks")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!inviteLink) return null;

    const team = await ctx.db.get("teams", inviteLink.teamId);
    if (!team) return null;

    const now = Date.now();
    const expired = inviteLink.expiresAt ? inviteLink.expiresAt < now : false;
    const maxedOut = inviteLink.maxUses
      ? inviteLink.useCount >= inviteLink.maxUses
      : false;
    const valid = !expired && !maxedOut;

    // Optionally check if the current user is already a member
    const userId = await getAuthUserId(ctx);
    let isMember = false;
    if (userId) {
      const membership = await ctx.db
        .query("teamMembers")
        .withIndex("by_teamId_userId", (q) =>
          q.eq("teamId", inviteLink.teamId).eq("userId", userId),
        )
        .unique();
      isMember = !!membership;
    }

    return {
      teamName: team.name,
      valid,
      expired,
      maxedOut,
      isAuthenticated: !!userId,
      isMember,
    };
  },
});

export const acceptInviteLink = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const inviteLink = await ctx.db
      .query("inviteLinks")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!inviteLink) throw new Error("Invite link not found");

    const now = Date.now();
    if (inviteLink.expiresAt && inviteLink.expiresAt < now) {
      throw new Error("Invite link has expired");
    }
    if (inviteLink.maxUses && inviteLink.useCount >= inviteLink.maxUses) {
      throw new Error("Invite link has reached its maximum uses");
    }

    const existingMembership = await ctx.db
      .query("teamMembers")
      .withIndex("by_teamId_userId", (q) =>
        q.eq("teamId", inviteLink.teamId).eq("userId", userId),
      )
      .unique();
    if (existingMembership) {
      throw new Error("You are already a member of this team");
    }

    await ctx.db.insert("teamMembers", {
      teamId: inviteLink.teamId,
      userId,
      role: "member",
      invitedAt: inviteLink.createdAt,
      joinedAt: Date.now(),
    });

    await ctx.db.patch("inviteLinks", inviteLink._id, {
      useCount: inviteLink.useCount + 1,
    });

    return inviteLink.teamId;
  },
});

export const listInviteLinks = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const team = await ctx.db.get("teams", args.teamId);
    if (!team || team.ownerId !== userId) return [];
    return await ctx.db
      .query("inviteLinks")
      .withIndex("by_teamId", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const deleteInviteLink = mutation({
  args: { inviteLinkId: v.id("inviteLinks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const inviteLink = await ctx.db.get("inviteLinks", args.inviteLinkId);
    if (!inviteLink) throw new Error("Invite link not found");
    const team = await ctx.db.get("teams", inviteLink.teamId);
    if (!team || team.ownerId !== userId) throw new Error("Not authorized");
    await ctx.db.delete("inviteLinks", args.inviteLinkId);
  },
});
