"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  PageHeaderSkeleton,
  CardSkeleton,
  ListItemSkeleton,
} from "@/components/ui/DashboardSkeleton";

function MembersList({
  teamId,
  isOwner,
}: {
  teamId: Id<"teams">;
  isOwner: boolean;
}) {
  const members = useQuery(api.teams.listMembers, { teamId });
  const removeMember = useMutation(api.teams.removeMember);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmMember, setConfirmMember] = useState<{
    id: Id<"teamMembers">;
    name: string;
  } | null>(null);
  const { toast } = useToast();

  if (members === undefined) {
    return (
      <div className="divide-y divide-zinc-800">
        <ListItemSkeleton />
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    );
  }

  if (members.length <= 1) {
    return (
      <div className="px-4 py-3 text-sm text-zinc-500">
        No other members yet
      </div>
    );
  }

  async function handleConfirmRemove() {
    if (!confirmMember) return;
    setRemoving(confirmMember.id);
    try {
      await removeMember({ teamId, memberId: confirmMember.id });
      toast({ type: "success", message: "Member removed" });
      setConfirmMember(null);
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to remove member",
      });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <ul className="divide-y divide-zinc-800">
        {members.map((member) => (
          <li
            key={member._id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-200">
                {member.name ?? member.email ?? "Unknown user"}
              </p>
              {member.name && member.email && (
                <p className="truncate text-xs text-zinc-500">{member.email}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  member.role === "owner"
                    ? "bg-amber-900/50 text-amber-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {member.role}
              </span>
              {isOwner && member.role !== "owner" && (
                <button
                  onClick={() =>
                    setConfirmMember({
                      id: member._id,
                      name: member.name ?? member.email ?? "this member",
                    })
                  }
                  disabled={removing === member._id}
                  className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
                >
                  {removing === member._id ? "Removing..." : "Remove"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmMember !== null}
        onClose={() => setConfirmMember(null)}
        onConfirm={handleConfirmRemove}
        title="Remove member"
        description={`Are you sure you want to remove ${confirmMember?.name} from this team?`}
        confirmLabel="Remove"
        variant="danger"
        loading={removing !== null}
      />
    </>
  );
}

function RepoList({
  teamId,
  isOwner,
}: {
  teamId: Id<"teams">;
  isOwner: boolean;
}) {
  const repos = useQuery(api.projects.listByTeam, { teamId });
  const removeRepo = useMutation(api.projects.removeRepo);
  const [removing, setRemoving] = useState<string | null>(null);

  if (repos === undefined) {
    return (
      <div className="divide-y divide-zinc-800">
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-zinc-500">
        No repositories connected
      </div>
    );
  }

  async function handleRemove(repoId: Id<"repos">) {
    setRemoving(repoId);
    try {
      await removeRepo({ repoId });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <ul className="divide-y divide-zinc-800">
      {repos.map((repo) => (
        <li
          key={repo._id}
          className="flex items-center justify-between px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-200">
              {repo.githubOwner}/{repo.githubRepo}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-xs text-zinc-500">
                {repo.defaultBranch}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  repo.pushStrategy === "direct"
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-blue-900/50 text-blue-300"
                }`}
              >
                {repo.pushStrategy === "direct" ? "Direct" : "PR"}
              </span>
            </div>
          </div>
          {isOwner && (
            <button
              onClick={() => handleRemove(repo._id)}
              disabled={removing === repo._id}
              className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
            >
              {removing === repo._id ? "Removing..." : "Remove"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddRepoForm({ teamId, onClose }: { teamId: Id<"teams">; onClose?: () => void }) {
  const addRepo = useMutation(api.projects.addRepo);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [pushStrategy, setPushStrategy] = useState<"direct" | "pr">("pr");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const owner = githubOwner.trim();
    const repo = githubRepo.trim();
    if (!owner || !repo) return;
    setAdding(true);
    setError(null);
    try {
      await addRepo({
        teamId,
        githubOwner: owner,
        githubRepo: repo,
        defaultBranch: defaultBranch.trim() || "main",
        pushStrategy,
      });
      setGithubOwner("");
      setGithubRepo("");
      setDefaultBranch("main");
      setPushStrategy("pr");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect repository",
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={githubOwner}
          onChange={(e) => setGithubOwner(e.target.value)}
          placeholder="Owner (e.g. facebook)"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
        <span className="text-zinc-500">/</span>
        <input
          type="text"
          value={githubRepo}
          onChange={(e) => setGithubRepo(e.target.value)}
          placeholder="Repo (e.g. react)"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          placeholder="Default branch"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
        <select
          value={pushStrategy}
          onChange={(e) => setPushStrategy(e.target.value as "direct" | "pr")}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        >
          <option value="pr">Create PR</option>
          <option value="direct">Direct to main</option>
        </select>
        <button
          type="submit"
          disabled={adding || !githubOwner.trim() || !githubRepo.trim()}
          className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
        >
          {adding ? "Connecting..." : "Connect"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}

interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
}

function RepoBrowser({
  teamId,
  existingRepos,
  onClose,
}: {
  teamId: Id<"teams">;
  existingRepos: Array<{ githubOwner: string; githubRepo: string }>;
  onClose: () => void;
}) {
  const listRepos = useAction(api.github.listUserRepos);
  const addRepo = useMutation(api.projects.addRepo);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<
    Record<string, "direct" | "pr">
  >({});
  const { toast } = useToast();

  useEffect(() => {
    listRepos({})
      .then(setRepos)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load repos"),
      )
      .finally(() => setLoading(false));
  }, [listRepos]);

  const filtered = repos?.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  const isConnected = (owner: string, name: string) =>
    existingRepos.some(
      (r) => r.githubOwner === owner && r.githubRepo === name,
    );

  async function handleConnect(repo: GithubRepo) {
    const key = `${repo.owner}/${repo.name}`;
    setConnecting(key);
    try {
      await addRepo({
        teamId,
        githubOwner: repo.owner,
        githubRepo: repo.name,
        defaultBranch: repo.defaultBranch,
        pushStrategy: selectedStrategy[key] ?? "pr",
      });
      toast({ type: "success", message: `Connected ${key}` });
    } catch (err) {
      toast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to connect",
      });
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">
          Your GitHub Repositories
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Close
        </button>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search repos..."
        className="mb-3 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
      />
      {loading && (
        <p className="text-sm text-zinc-500">Loading repos from GitHub...</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {filtered && (
        <ul className="max-h-80 divide-y divide-zinc-800 overflow-y-auto rounded border border-zinc-800">
          {filtered.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const connected = isConnected(repo.owner, repo.name);
            return (
              <li
                key={key}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-200">
                    {repo.fullName}
                  </p>
                  {repo.description && (
                    <p className="truncate text-xs text-zinc-500">
                      {repo.description}
                    </p>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                    <span>{repo.defaultBranch}</span>
                    {repo.private && (
                      <span className="text-amber-400">Private</span>
                    )}
                  </div>
                </div>
                {connected ? (
                  <span className="text-xs font-medium text-emerald-400">
                    Connected
                  </span>
                ) : (
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <select
                      value={selectedStrategy[key] ?? "pr"}
                      onChange={(e) =>
                        setSelectedStrategy((s) => ({
                          ...s,
                          [key]: e.target.value as "direct" | "pr",
                        }))
                      }
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                    >
                      <option value="pr">PR</option>
                      <option value="direct">Direct</option>
                    </select>
                    <button
                      onClick={() => handleConnect(repo)}
                      disabled={connecting === key}
                      className="rounded bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                    >
                      {connecting === key ? "..." : "Connect"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-zinc-500">
              No repos match your search
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function AddRepoSection({ teamId }: { teamId: Id<"teams"> }) {
  const profile = useQuery(api.users.getProfile);
  const existingRepos = useQuery(api.projects.listByTeam, { teamId });
  const [showBrowser, setShowBrowser] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const hasGithub = !!profile?.githubUsername;

  if (hasGithub && showBrowser) {
    return (
      <RepoBrowser
        teamId={teamId}
        existingRepos={existingRepos ?? []}
        onClose={() => setShowBrowser(false)}
      />
    );
  }

  if (showManual) {
    return <AddRepoForm teamId={teamId} onClose={() => setShowManual(false)} />;
  }

  return (
    <div className="px-4 py-3">
      {hasGithub ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBrowser(true)}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Browse GitHub Repos
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            or enter manually
          </button>
        </div>
      ) : (
        <div className="text-sm text-zinc-400">
          <a
            href="/settings"
            className="text-blue-400 hover:text-blue-300"
          >
            Connect your GitHub account
          </a>{" "}
          to browse repos, or{" "}
          <button
            onClick={() => setShowManual(true)}
            className="text-zinc-300 underline"
          >
            enter manually
          </button>
          .
        </div>
      )}
    </div>
  );
}

function InviteSection({ teamId }: { teamId: Id<"teams"> }) {
  const invites = useQuery(api.teams.listInvites, { teamId });
  const inviteMember = useMutation(api.teams.inviteMember);
  const cancelInvite = useMutation(api.teams.cancelInvite);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setError(null);
    try {
      await inviteMember({ teamId, email: trimmed });
      setEmail("");
      toast({ type: "success", message: `Invite sent to ${trimmed}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite";
      setError(msg);
      toast({ type: "error", message: msg });
    } finally {
      setInviting(false);
    }
  }

  async function handleCancel(inviteId: Id<"invites">) {
    setCancelling(inviteId);
    try {
      await cancelInvite({ inviteId });
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div>
      <form onSubmit={handleInvite} className="flex items-center gap-2 px-4 py-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={inviting || !email.trim()}
          className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
        >
          {inviting ? "Sending..." : "Send Invite"}
        </button>
      </form>
      {error && (
        <p className="px-4 pb-2 text-xs text-red-400">{error}</p>
      )}
      {invites && invites.length > 0 ? (
        <ul className="divide-y divide-zinc-800 border-t border-zinc-800">
          {invites.map((invite) => (
            <li
              key={invite._id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-300">{invite.email}</p>
                <p className="text-xs text-zinc-500">Pending invite</p>
              </div>
              <button
                onClick={() => handleCancel(invite._id)}
                disabled={cancelling === invite._id}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
              >
                {cancelling === invite._id ? "Cancelling..." : "Cancel"}
              </button>
            </li>
          ))}
        </ul>
      ) : invites ? (
        <div className="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-500">
          No pending invites
        </div>
      ) : null}
    </div>
  );
}

export default function TeamManagementPage() {
  const params = useParams();
  const teamId = params.teamId as Id<"teams">;
  const team = useQuery(api.teams.getTeam, { teamId });

  if (team === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeaderSkeleton />
        <div className="mt-8 space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    );
  }

  if (team === null) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/home"
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back to dashboard
        </Link>
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            Team not found or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = team.myRole === "owner";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/home"
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        &larr; Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-zinc-100">{team.name}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Team management {isOwner ? "(Owner)" : "(Member)"}
      </p>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">Members</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <MembersList teamId={teamId} isOwner={isOwner} />
        </div>
      </div>

      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200">
            Invite Members
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <InviteSection teamId={teamId} />
          </div>
        </div>
      )}

      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <Link
              href={`/team/${teamId}/llm-settings`}
              className="flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800/50"
            >
              <div>
                <p className="font-medium text-zinc-200">LLM Settings</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Configure a custom AI provider and API key
                </p>
              </div>
              <span className="text-zinc-500">&rarr;</span>
            </Link>
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">Repositories</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <RepoList teamId={teamId} isOwner={isOwner} />
          {isOwner && (
            <div className="border-t border-zinc-800">
              <AddRepoSection teamId={teamId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
