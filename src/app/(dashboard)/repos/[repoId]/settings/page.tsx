"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function RepoSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const repoId = params.repoId as Id<"repos">;
  const repo = useQuery(api.projects.getRepoWithTeam, { repoId });
  const updateRepo = useMutation(api.projects.updateRepo);
  const removeRepo = useMutation(api.projects.removeRepo);

  const [pushStrategy, setPushStrategy] = useState<"direct" | "pr" | null>(
    null,
  );
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { toast } = useToast();

  if (repo === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
        </div>
      </div>
    );
  }

  if (repo === null) {
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
            Repository not found or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = repo.myRole === "owner";
  const currentPushStrategy = pushStrategy ?? repo.pushStrategy;
  const currentDefaultBranch = defaultBranch ?? repo.defaultBranch;
  const hasChanges =
    currentPushStrategy !== repo.pushStrategy ||
    currentDefaultBranch !== repo.defaultBranch;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateRepo({
        repoId,
        pushStrategy: currentPushStrategy,
        defaultBranch: currentDefaultBranch,
      });
      setPushStrategy(null);
      setDefaultBranch(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast({ type: "success", message: "Settings saved" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save settings",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await removeRepo({ repoId });
      router.push("/home");
    } catch {
      setDisconnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/home"
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        &larr; Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-zinc-100">
        Repository Settings
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {repo.githubOwner}/{repo.githubRepo}
      </p>

      {/* Repo info */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">Information</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <dl className="divide-y divide-zinc-800">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">Repository</dt>
              <dd className="text-sm font-medium text-zinc-200">
                {repo.githubOwner}/{repo.githubRepo}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">GitHub URL</dt>
              <dd>
                <a
                  href={repo.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  {repo.githubUrl}
                </a>
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">Team</dt>
              <dd className="text-sm font-medium text-zinc-200">
                {repo.teamName}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">Connected</dt>
              <dd className="text-sm text-zinc-200">
                {new Date(repo.connectedAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Edit form - only for owners */}
      {isOwner ? (
        <form onSubmit={handleSave} className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200">Configuration</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <div className="space-y-4 p-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300">
                  Push Strategy
                </label>
                <div className="mt-2 flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="radio"
                      name="pushStrategy"
                      value="direct"
                      checked={currentPushStrategy === "direct"}
                      onChange={() => setPushStrategy("direct")}
                      className="accent-zinc-100"
                    />
                    Direct push
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="radio"
                      name="pushStrategy"
                      value="pr"
                      checked={currentPushStrategy === "pr"}
                      onChange={() => setPushStrategy("pr")}
                      className="accent-zinc-100"
                    />
                    Create PR
                  </label>
                </div>
              </div>

              <div>
                <label
                  htmlFor="defaultBranch"
                  className="block text-sm font-medium text-zinc-300"
                >
                  Default Branch
                </label>
                <input
                  id="defaultBranch"
                  type="text"
                  value={currentDefaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-3">
              <button
                type="submit"
                disabled={saving || !hasChanges}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              {saved && (
                <span className="text-sm text-emerald-400">Saved</span>
              )}
            </div>
          </div>
        </form>
      ) : (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200">Configuration</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm text-zinc-500">
              Only the team owner can edit repository settings.
            </p>
          </div>
        </div>
      )}

      {/* Danger zone - only for owners */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-red-900/50 bg-zinc-900">
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Disconnect Repository
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Remove this repository from your team. This cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setShowDisconnect(true)}
                className="rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-900/30"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Repository?"
        description={`Are you sure you want to disconnect ${repo.githubOwner}/${repo.githubRepo}? This will remove the repository and all associated sessions.`}
        confirmLabel="Disconnect"
        variant="danger"
        loading={disconnecting}
      />
    </div>
  );
}
