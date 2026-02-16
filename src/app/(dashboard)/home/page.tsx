"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
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

function RecentSessions() {
  const sessions = useQuery(api.sessions.listRecent, { limit: 5 });

  if (sessions === undefined) {
    return (
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">Recent Work</h2>
        <div className="mt-3 space-y-2">
          <ListItemSkeleton />
          <ListItemSkeleton />
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">Recent Work</h2>
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="mx-auto h-8 w-8 text-zinc-600"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
            />
          </svg>
          <p className="mt-2 text-sm text-zinc-400">
            No recent work yet
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Open a repository to start chatting with AI and making changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-200">Recent Work</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <ul className="divide-y divide-zinc-800">
          {sessions.map((session) => (
            <li key={session._id}>
              <Link
                href={`/workspace/${session.repoId}?session=${session._id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/50"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 shrink-0 text-zinc-500"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25ZM3 4.25c0-.69.56-1.25 1.25-1.25h11.5c.69 0 1.25.56 1.25 1.25v11.5c0 .69-.56 1.25-1.25 1.25H4.25C3.56 17 3 16.44 3 15.75V4.25Z"
                    clipRule="evenodd"
                  />
                  <path d="M10 8a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 10 8Z" />
                </svg>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">
                    {session.featureName ??
                      session.name ??
                      session.firstMessage ??
                      "Untitled session"}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="truncate">{session.repoName}</span>
                    {session.branchName && (
                      <>
                        <span>·</span>
                        <span className="truncate font-mono text-blue-400">
                          {session.branchName}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 text-xs text-zinc-500">
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
  const [dismissed, setDismissed] = useState(true); // Start true to avoid flash

  useEffect(() => {
    // Check localStorage on mount
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
      actionLabel: "Browse Repos",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  // Find the index of the next incomplete step
  const nextStepIndex = steps.findIndex((s) => !s.done);

  function handleDismiss() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    setDismissed(true);
  }

  if (allDone) {
    return (
      <div className="mb-6 rounded-lg border border-green-500/30 bg-green-950/20 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5 text-green-400"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium text-green-300">Setup complete!</p>
              <p className="text-sm text-green-400/70">
                You&apos;re all set to start using Artie.
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded-md px-3 py-1.5 text-sm text-green-400 hover:bg-green-500/10 hover:text-green-300"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium text-zinc-200">Get started with Artie</h3>
        <span className="text-sm text-zinc-500">
          {completedCount} of {steps.length} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const isNext = index === nextStepIndex;
          const isFuture = index > nextStepIndex && nextStepIndex !== -1;

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between rounded-md px-3 py-2 ${
                step.done
                  ? "bg-zinc-800/50"
                  : isNext
                    ? "bg-zinc-800"
                    : "opacity-50"
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Status icon */}
                {step.done ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3.5 w-3.5 text-green-400"
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
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      isNext ? "border-blue-500" : "border-zinc-600"
                    }`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        isNext ? "text-blue-400" : "text-zinc-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                  </div>
                )}

                <span
                  className={`text-sm ${
                    step.done
                      ? "text-zinc-400 line-through"
                      : isNext
                        ? "text-zinc-200"
                        : "text-zinc-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Action button for next step */}
              {isNext && !isFuture && (
                <>
                  {step.href ? (
                    <Link
                      href={step.href}
                      className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
                    >
                      {step.actionLabel}
                    </Link>
                  ) : step.action ? (
                    <button
                      onClick={step.action}
                      className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
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

function TemplateProjects({ teamId }: { teamId: Id<"teams"> }) {
  const projects = useQuery(api.templates.listByTeam, { teamId });

  if (projects === undefined) {
    return (
      <div className="divide-y divide-zinc-800">
        <ListItemSkeleton />
      </div>
    );
  }
  if (projects.length === 0) return null;

  return (
    <ul className="divide-y divide-zinc-800">
      {projects.map((project) => (
        <li key={project._id}>
          <Link
            href={`/team/${project.teamId}/templates/${project._id}`}
            className="flex items-center px-4 py-3 transition-colors hover:bg-zinc-800/50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mr-3 h-4 w-4 shrink-0 text-purple-400"
            >
              <path d="M3.196 12.87l-.825.483a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-.825-.484-5.554 3.24a2.5 2.5 0 01-2.5 0L3.196 12.87z" />
              <path d="M3.196 8.87l-.825.483a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-.825-.484-5.554 3.24a2.5 2.5 0 01-2.5 0L3.196 8.87z" />
              <path d="M10.625 2.813a1.5 1.5 0 00-1.25 0L2.371 6.899a.75.75 0 000 1.294l7.004 4.086a1.5 1.5 0 001.25 0l7.004-4.086a.75.75 0 000-1.294l-7.004-4.086z" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-200">
                {project.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Next.js + Convex</span>
                <span>·</span>
                <span
                  className={
                    project.status === "active"
                      ? "text-green-400"
                      : project.status === "provisioning"
                        ? "text-yellow-400"
                        : "text-red-400"
                  }
                >
                  {project.status}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creatingProject) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 animate-dialog-in">
        <h2 className="text-lg font-semibold text-zinc-100">
          Create from Template
        </h2>
        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          {/* Project Name */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">
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
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Slug</label>
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
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
              {projectSlug.length > 0 && slugAvailable !== undefined && (
                <span className="shrink-0 text-sm">
                  {slugAvailable ? (
                    <span className="text-green-400">&#10003;</span>
                  ) : (
                    <span className="text-red-400">&#10007;</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Template (read-only) */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">
              Template
            </label>
            <div className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300">
              Next.js + Convex
            </div>
          </div>

          {/* Deploy Key Selector */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">
              Fly.io Deploy Key
            </label>
            {deployKeys === undefined ? (
              <div className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-500">
                Loading...
              </div>
            ) : deployKeys.length === 0 ? (
              <div className="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-500">
                No deploy keys.{" "}
                <Link
                  href={`/team/${teamId}/deploy-keys`}
                  className="text-blue-400 hover:underline"
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
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
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
              className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
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
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
  const profile = useQuery(api.users.getProfile);
  const hasRepos = useQuery(api.projects.hasAnyRepos);
  const createTeam = useMutation(api.teams.createTeam);
  const [showCreate, setShowCreate] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templateTeamId, setTemplateTeamId] = useState<Id<"teams"> | null>(
    null,
  );

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

      {/* Onboarding Checklist — shown for new users */}
      {teams !== undefined &&
        profile !== undefined &&
        hasRepos !== undefined && (
          <div className="mt-6">
            <OnboardingChecklist
              teams={teams}
              profile={profile}
              hasRepos={hasRepos}
              onCreateTeam={() => setShowCreate(true)}
            />
          </div>
        )}

      <div className="mt-6">
        <PendingInvites />
      </div>

      <RecentSessions />

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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTemplateTeamId(team._id)}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    + Template
                  </button>
                  <Link
                    href={`/team/${team._id}`}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Manage
                  </Link>
                </div>
              </div>
              <TeamRepos teamId={team._id} />
              <TemplateProjects teamId={team._id} />
            </div>
          ))}
        </div>
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
