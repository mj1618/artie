"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/useToast";
import { CardSkeleton, ListItemSkeleton } from "@/components/ui/DashboardSkeleton";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type SessionData = {
  _id: Id<"sessions">;
  repoId: Id<"repos">;
  repoName: string;
  branchName?: string;
  featureName?: string;
  name?: string;
  firstMessage?: string;
  lastActiveAt: number;
};

type RepoData = {
  _id: Id<"repos">;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
};

function QuickActions({
  sessions,
  repos,
  onCreateTeam,
}: {
  sessions: SessionData[] | undefined;
  repos: RepoData[];
  onCreateTeam: () => void;
}) {
  const router = useRouter();
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowRepoDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const lastSession = sessions?.[0];
  const hasRepos = repos.length > 0;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {lastSession && (
        <Link
          href={`/workspace/${lastSession.repoId}?session=${lastSession._id}`}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-primary-hover"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M2 10a.75.75 0 0 1 .75-.75h12.59l-2.1-1.95a.75.75 0 1 1 1.02-1.1l3.5 3.25a.75.75 0 0 1 0 1.1l-3.5 3.25a.75.75 0 1 1-1.02-1.1l2.1-1.95H2.75A.75.75 0 0 1 2 10Z"
              clipRule="evenodd"
            />
          </svg>
          Continue Last
        </Link>
      )}

      {hasRepos && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowRepoDropdown(!showRepoDropdown)}
            className="inline-flex items-center gap-2 rounded-md border border-paper-300 bg-paper-50 px-4 py-2 text-sm font-medium text-paper-700 shadow-paper-sm transition-colors hover:bg-paper-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            New Session
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {showRepoDropdown && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-paper-300 bg-paper-50 py-1 shadow-paper-lg">
              {repos.map((repo) => (
                <button
                  key={repo._id}
                  onClick={() => {
                    setShowRepoDropdown(false);
                    router.push(`/workspace/${repo._id}`);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-paper-700 transition-colors hover:bg-paper-100"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4 shrink-0 text-paper-400"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="truncate">
                    {repo.githubOwner}/{repo.githubRepo}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onCreateTeam}
        className="inline-flex items-center gap-2 rounded-md border border-paper-300 bg-paper-50 px-4 py-2 text-sm font-medium text-paper-700 shadow-paper-sm transition-colors hover:bg-paper-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
        </svg>
        Create Team
      </button>
    </div>
  );
}

function JumpBackIn({ sessions }: { sessions: SessionData[] | undefined }) {
  if (sessions === undefined) {
    return (
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-paper-900">Jump Back In</h2>
        </div>
        <div className="mt-3 space-y-2">
          <ListItemSkeleton />
          <ListItemSkeleton />
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return null;
  }

  const displaySessions = sessions.slice(0, 3);
  const hasMore = sessions.length > 3;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-paper-900">Jump Back In</h2>
        {hasMore && (
          <Link
            href="/sessions"
            className="text-sm font-medium text-sky transition-colors hover:text-sky-light"
          >
            View all
          </Link>
        )}
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-50 shadow-paper">
        <ul className="divide-y divide-paper-200">
          {displaySessions.map((session) => (
            <li key={session._id}>
              <Link
                href={`/workspace/${session.repoId}?session=${session._id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-paper-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z"
                    clipRule="evenodd"
                  />
                </svg>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-paper-900">
                      {session.repoName}
                    </span>
                    {session.branchName && (
                      <span className="truncate rounded bg-sky/10 px-1.5 py-0.5 font-mono text-xs text-sky">
                        {session.branchName}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-paper-500">
                    {session.featureName ??
                      session.name ??
                      session.firstMessage ??
                      "Untitled session"}
                  </p>
                </div>

                <span className="shrink-0 text-xs text-paper-500">
                  {formatRelativeTime(session.lastActiveAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const ONBOARDING_DISMISSED_KEY = "artie_onboarding_dismissed";

function OnboardingChecklist({
  teams,
  profile,
  hasRepos,
  onCreateTeam,
}: {
  teams: Array<{ _id: Id<"teams">; name: string }>;
  profile: { githubUsername?: string } | null;
  hasRepos: boolean;
  onCreateTeam: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(ONBOARDING_DISMISSED_KEY);
    setDismissed(stored === "true");
  }, []);

  if (dismissed) return null;

  const steps = [
    {
      id: "team",
      label: "Create a team",
      done: teams.length > 0,
      action: onCreateTeam,
      actionLabel: "Create Team",
    },
    {
      id: "github",
      label: "Connect your GitHub account",
      done: !!profile?.githubUsername,
      href: "/settings",
      actionLabel: "Connect GitHub",
    },
    {
      id: "repo",
      label: "Connect a repository",
      done: hasRepos,
      href: teams.length > 0 ? `/team/${teams[0]._id}` : undefined,
      actionLabel: "Add Repo",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const nextStepIndex = steps.findIndex((s) => !s.done);

  function handleDismiss() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    setDismissed(true);
  }

  if (allDone) {
    return (
      <div className="rounded-lg border border-sage/30 bg-success-light p-4 shadow-paper">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sage/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5 text-sage"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium text-sage">Setup complete!</p>
              <p className="text-sm text-sage-light">
                You&apos;re all set to start using Composure.
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-sage transition-colors hover:bg-sage/10"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 p-4 shadow-paper">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-paper-900">Getting Started</h3>
        <span className="text-xs text-paper-500">
          {completedCount}/{steps.length}
        </span>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-paper-200">
        <div
          className="h-full bg-sepia transition-all duration-300"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {steps.map((step, index) => {
          const isNext = index === nextStepIndex;

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between rounded-md px-2.5 py-2 transition-all ${
                step.done
                  ? "bg-paper-100/50"
                  : isNext
                    ? "bg-paper-100 ring-1 ring-paper-300"
                    : "opacity-50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {step.done ? (
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-sage/20">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3 w-3 text-sage"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                ) : (
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      isNext ? "border-sepia" : "border-paper-400"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-medium ${
                        isNext ? "text-sepia" : "text-paper-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                  </div>
                )}

                <span
                  className={`text-sm ${
                    step.done
                      ? "text-paper-500 line-through"
                      : isNext
                        ? "font-medium text-paper-900"
                        : "text-paper-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {isNext && (
                <>
                  {step.href ? (
                    <Link
                      href={step.href}
                      className="rounded-md bg-sepia px-2.5 py-1 text-xs font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-sepia-light"
                    >
                      {step.actionLabel}
                    </Link>
                  ) : step.action ? (
                    <button
                      onClick={step.action}
                      className="rounded-md bg-sepia px-2.5 py-1 text-xs font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-sepia-light"
                    >
                      {step.actionLabel}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const [teamName, setTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const createTeam = useMutation(api.teams.createTeam);
  const { toast } = useToast();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !creating) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, creating]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = teamName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createTeam({ name });
      toast({ type: "success", message: "Team created" });
      onClose();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-950/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-50 p-6 shadow-paper-lg animate-dialog-in">
        <h2 className="text-lg font-semibold text-paper-900">Create Team</h2>
        <p className="mt-1 text-sm text-paper-500">
          Teams let you organize repositories and collaborate with others.
        </p>
        <form onSubmit={handleCreate} className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-paper-700">
            Team Name
          </label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="My Team"
            autoFocus
            className="w-full rounded-md border border-paper-300 bg-paper-100 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 shadow-paper-sm outline-none transition-shadow focus:border-sepia-light focus:ring-2 focus:ring-sepia-light/20"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="rounded-md px-3 py-2 text-sm font-medium text-paper-600 transition-colors hover:text-paper-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !teamName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Team"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
          className="flex items-center justify-between rounded-lg border border-sky/30 bg-info-light px-4 py-3 shadow-paper"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm text-paper-800">
              You&apos;ve been invited to join{" "}
              <span className="font-semibold">{invite.teamName}</span>
            </p>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            <button
              onClick={() => handleAccept(invite._id)}
              disabled={loadingId === invite._id}
              className="rounded-md bg-sky px-3 py-1.5 text-sm font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-sky-light disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => handleDecline(invite._id)}
              disabled={loadingId === invite._id}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-paper-600 transition-colors hover:text-paper-900 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateProjects({
  teamId,
  onCreateTemplate,
}: {
  teamId: Id<"teams">;
  onCreateTemplate: () => void;
}) {
  const projects = useQuery(api.templates.listByTeam, { teamId });

  if (projects === undefined) {
    return (
      <div className="border-t border-paper-200 px-4 py-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-paper-500">
            Templates
          </span>
        </div>
        <div className="space-y-1">
          <ListItemSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-paper-200 px-4 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-paper-500">
            Templates {projects.length > 0 && `(${projects.length})`}
          </span>
        </div>
        <button
          onClick={onCreateTemplate}
          className="text-xs font-medium text-sky transition-colors hover:text-sky-light"
        >
          + New
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="py-2 text-center text-xs text-paper-400">
          Provision new apps from templates
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {projects.map((project) => (
            <li key={project._id}>
              <Link
                href={`/team/${project.teamId}/templates/${project._id}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-paper-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-sepia"
                >
                  <path d="M3.196 12.87l-.825.483a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-.825-.484-5.554 3.24a2.5 2.5 0 01-2.5 0L3.196 12.87z" />
                  <path d="M3.196 8.87l-.825.483a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-.825-.484-5.554 3.24a2.5 2.5 0 01-2.5 0L3.196 8.87z" />
                  <path d="M10.625 2.813a1.5 1.5 0 00-1.25 0L2.371 6.899a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-7.004-4.086z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-paper-900">
                    {project.name}
                  </p>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    project.status === "active"
                      ? "bg-sage/10 text-sage"
                      : project.status === "provisioning"
                        ? "bg-sepia/10 text-sepia"
                        : "bg-terracotta/10 text-terracotta"
                  }`}
                >
                  {project.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function CreateTemplateDialog({
  teamId,
  onClose,
}: {
  teamId: Id<"teams">;
  onClose: () => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [selectedDeployKeyId, setSelectedDeployKeyId] =
    useState<Id<"flyioDeployKeys"> | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  const deployKeys = useQuery(api.deployKeys.listByTeam, { teamId });
  const slugAvailable = useQuery(
    api.templates.checkSlugAvailable,
    projectSlug.length > 0 ? { slug: projectSlug } : "skip",
  );
  const createProject = useMutation(api.templates.create);
  const provisionProject = useAction(api.templateActions.provisionProject);
  const { toast } = useToast();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !creatingProject) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, creatingProject]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim() || !projectSlug || !selectedDeployKeyId) return;
    setCreatingProject(true);
    try {
      const projectId = await createProject({
        teamId,
        name: projectName.trim(),
        slug: projectSlug,
        template: "nextjs-convex",
        flyioDeployKeyId: selectedDeployKeyId,
      });
      // Fire-and-forget: start provisioning in the background
      provisionProject({ projectId }).catch(console.error);
      toast({ type: "success", message: "Template project created" });
      onClose();
    } catch (err) {
      toast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to create project",
      });
    } finally {
      setCreatingProject(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-950/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creatingProject) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-paper-300 bg-paper-50 p-6 shadow-paper-lg animate-dialog-in">
        <h2 className="text-lg font-semibold text-paper-900">
          Create from Template
        </h2>
        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          {/* Project Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                if (!slugManuallyEdited) {
                  setProjectSlug(nameToSlug(e.target.value));
                }
              }}
              placeholder="My Cool App"
              autoFocus
              className="w-full rounded-md border border-paper-300 bg-paper-100 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 shadow-paper-sm outline-none transition-shadow focus:border-sepia-light focus:ring-2 focus:ring-sepia-light/20"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">Slug</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={projectSlug}
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setProjectSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ""),
                  );
                }}
                placeholder="my-cool-app"
                className="w-full rounded-md border border-paper-300 bg-paper-100 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 shadow-paper-sm outline-none transition-shadow focus:border-sepia-light focus:ring-2 focus:ring-sepia-light/20"
              />
              {projectSlug.length > 0 && slugAvailable !== undefined && (
                <span className="shrink-0 text-sm">
                  {slugAvailable ? (
                    <span className="text-sage">&#10003;</span>
                  ) : (
                    <span className="text-terracotta">&#10007;</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Template (read-only) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              Template
            </label>
            <div className="rounded-md border border-paper-300 bg-paper-200 px-3 py-2 text-sm text-paper-700">
              Next.js + Convex
            </div>
          </div>

          {/* Deploy Key Selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              Fly.io Deploy Key
            </label>
            {deployKeys === undefined ? (
              <div className="rounded-md border border-paper-300 bg-paper-200 px-3 py-2 text-sm text-paper-500">
                Loading...
              </div>
            ) : deployKeys.length === 0 ? (
              <div className="rounded-md border border-paper-300 bg-paper-200 px-3 py-2 text-sm text-paper-500">
                No deploy keys.{" "}
                <Link
                  href={`/team/${teamId}/deploy-keys`}
                  className="text-sky hover:underline"
                >
                  Add one first
                </Link>
              </div>
            ) : (
              <select
                value={selectedDeployKeyId ?? ""}
                onChange={(e) =>
                  setSelectedDeployKeyId(
                    e.target.value
                      ? (e.target.value as Id<"flyioDeployKeys">)
                      : null,
                  )
                }
                className="w-full rounded-md border border-paper-300 bg-paper-100 px-3 py-2 text-sm text-paper-900 shadow-paper-sm outline-none transition-shadow focus:border-sepia-light focus:ring-2 focus:ring-sepia-light/20"
              >
                <option value="">Select a deploy key...</option>
                {deployKeys.map((key) => (
                  <option key={key._id} value={key._id}>
                    {key.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm font-medium text-paper-600 transition-colors hover:text-paper-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                creatingProject ||
                !projectName.trim() ||
                !projectSlug ||
                !selectedDeployKeyId ||
                slugAvailable === false
              }
              className="rounded-md bg-sepia px-4 py-2 text-sm font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-sepia-light disabled:opacity-50"
            >
              {creatingProject ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TeamRepos({ teamId }: { teamId: Id<"teams"> }) {
  const repos = useQuery(api.projects.listByTeam, { teamId });

  if (repos === undefined) {
    return (
      <div className="px-4 py-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-paper-500">
            Repositories
          </span>
        </div>
        <div className="space-y-1">
          <ListItemSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-paper-500">
          Repositories {repos.length > 0 && `(${repos.length})`}
        </span>
        <Link
          href={`/team/${teamId}`}
          className="text-xs font-medium text-sky transition-colors hover:text-sky-light"
        >
          + Add
        </Link>
      </div>
      {repos.length === 0 ? (
        <div className="rounded-md border border-dashed border-paper-300 px-3 py-4 text-center">
          <p className="text-sm text-paper-500">No repositories yet</p>
          <Link
            href={`/team/${teamId}`}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-sky transition-colors hover:text-sky-light"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Connect a repository
          </Link>
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {repos.map((repo) => (
            <li key={repo._id} className="group flex items-center rounded-md transition-colors hover:bg-paper-100">
              <Link
                href={`/workspace/${repo._id}`}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-paper-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-paper-900">
                    {repo.githubOwner}/{repo.githubRepo}
                  </p>
                </div>
                <span className="rounded bg-paper-200 px-1.5 py-0.5 font-mono text-xs text-paper-500">
                  {repo.defaultBranch}
                </span>
              </Link>
              <Link
                href={`/repos/${repo._id}/settings`}
                className="mr-1 rounded-md p-1.5 text-paper-400 opacity-0 transition-all hover:bg-paper-200 hover:text-paper-700 group-hover:opacity-100"
                title="Repository settings"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
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
      )}
    </div>
  );
}

export default function DashboardPage() {
  const teams = useQuery(api.teams.listMyTeams);
  const user = useQuery(api.users.currentUser);
  const profile = useQuery(api.users.getProfile);
  const hasRepos = useQuery(api.projects.hasAnyRepos);
  const sessions = useQuery(api.sessions.listRecent, { limit: 5 });
  const allRepos = useQuery(api.projects.listAll);

  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [templateTeamId, setTemplateTeamId] = useState<Id<"teams"> | null>(null);

  const displayName = user?.name ?? user?.email ?? "there";

  const flatRepos: RepoData[] = allRepos ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold text-paper-900">
        Welcome back, {displayName}
      </h1>

      <QuickActions
        sessions={sessions}
        repos={flatRepos}
        onCreateTeam={() => setShowCreateTeam(true)}
      />

      {/* Pending Invites - urgent, shown first */}
      <div className="mt-6">
        <PendingInvites />
      </div>

      {/* Onboarding Checklist - for new users */}
      {teams !== undefined &&
        profile !== undefined &&
        hasRepos !== undefined && (
          <div className="mt-6">
            <OnboardingChecklist
              teams={teams}
              profile={profile}
              hasRepos={hasRepos}
              onCreateTeam={() => setShowCreateTeam(true)}
            />
          </div>
        )}

      {/* Jump Back In - recent sessions */}
      <JumpBackIn sessions={sessions} />

      {/* Your Teams */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-paper-900">Your Teams</h2>
      </div>

      {teams === undefined ? (
        <div className="mt-4 space-y-4">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      ) : teams.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-6 py-8 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="mx-auto h-10 w-10 text-paper-300"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
            />
          </svg>
          <h3 className="mt-3 text-sm font-medium text-paper-900">No teams yet</h3>
          <p className="mt-1 text-sm text-paper-500">
            Create a team to start connecting repositories.
          </p>
          <button
            onClick={() => setShowCreateTeam(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-paper-50 shadow-paper-sm transition-colors hover:bg-primary-hover"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Create your first team
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {teams.map((team) => (
            <div
              key={team._id}
              className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50 shadow-paper"
            >
              <div className="flex items-center justify-between border-b border-paper-200 bg-paper-100/50 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-paper-900">
                  {team.name}
                </h3>
                <Link
                  href={`/team/${team._id}`}
                  className="rounded-md px-2 py-1 text-xs font-medium text-paper-600 transition-colors hover:bg-paper-200 hover:text-paper-900"
                >
                  Manage
                </Link>
              </div>
              <TeamRepos teamId={team._id} />
              <TemplateProjects
                teamId={team._id}
                onCreateTemplate={() => setTemplateTeamId(team._id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreateTeam && (
        <CreateTeamDialog onClose={() => setShowCreateTeam(false)} />
      )}

      {templateTeamId && (
        <CreateTemplateDialog
          teamId={templateTeamId}
          onClose={() => setTemplateTeamId(null)}
        />
      )}
    </div>
  );
}
