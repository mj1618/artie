"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { CardSkeleton, ListItemSkeleton } from "@/components/ui/DashboardSkeleton";

function PendingInvites() {
  const invites = useQuery(api.teams.listMyInvites);
  const acceptInvite = useMutation(api.teams.acceptInvite);
  const declineInvite = useMutation(api.teams.declineInvite);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (!invites || invites.length === 0) return null;

  async function handleAccept(inviteId: Id<"invites">) {
    setLoadingId(inviteId);
    try {
      await acceptInvite({ inviteId });
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDecline(inviteId: Id<"invites">) {
    setLoadingId(inviteId);
    try {
      await declineInvite({ inviteId });
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {invites.map((invite) => (
        <div
          key={invite._id}
          className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-950/20 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-200">
              You&apos;ve been invited to join{" "}
              <span className="font-semibold">{invite.teamName}</span>
            </p>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            <button
              onClick={() => handleAccept(invite._id)}
              disabled={loadingId === invite._id}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => handleDecline(invite._id)}
              disabled={loadingId === invite._id}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamRepos({ teamId }: { teamId: Id<"teams"> }) {
  const repos = useQuery(api.projects.listByTeam, { teamId });

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
        No repos connected yet
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800">
      {repos.map((repo) => (
        <li key={repo._id} className="flex items-center transition-colors hover:bg-zinc-800/50">
          <Link
            href={`/workspace/${repo._id}`}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 shrink-0 text-zinc-500"
            >
              <path
                fillRule="evenodd"
                d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z"
                clipRule="evenodd"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-200">
                {repo.githubOwner}/{repo.githubRepo}
              </p>
              <p className="truncate text-xs text-zinc-500">{repo.defaultBranch}</p>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-zinc-600"
            >
              <path
                fillRule="evenodd"
                d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <Link
            href={`/repos/${repo._id}/settings`}
            className="mr-3 rounded p-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
            title="Repository settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const teams = useQuery(api.teams.listMyTeams);
  const user = useQuery(api.users.currentUser);
  const createTeam = useMutation(api.teams.createTeam);
  const [showCreate, setShowCreate] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [creating, setCreating] = useState(false);

  const displayName = user?.name ?? user?.email ?? "there";

  const { toast } = useToast();

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    const name = teamName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createTeam({ name });
      setTeamName("");
      setShowCreate(false);
      toast({ type: "success", message: "Team created" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create team",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold text-zinc-100">
        Welcome back, {displayName}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Select a repo to open the workspace, or create a new team.
      </p>

      <div className="mt-6">
        <PendingInvites />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-200">Your Teams</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          Create Team
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreateTeam}
          className="mt-4 flex items-center gap-2"
        >
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            autoFocus
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={creating || !teamName.trim()}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCreate(false);
              setTeamName("");
            }}
            className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </form>
      )}

      {teams === undefined ? (
        <div className="mt-6 space-y-4">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      ) : teams.length === 0 ? (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            You don&apos;t have any teams yet.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Create your first team
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {teams.map((team) => (
            <div
              key={team._id}
              className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <h3 className="text-sm font-semibold text-zinc-200">
                  {team.name}
                </h3>
                <Link
                  href={`/team/${team._id}`}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Manage
                </Link>
              </div>
              <TeamRepos teamId={team._id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
