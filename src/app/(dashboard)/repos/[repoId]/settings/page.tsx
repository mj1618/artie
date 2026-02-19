"use client";

import { useState } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
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
  const [runtime, setRuntime] = useState<"webcontainer" | "flyio-sprite" | "sandpack" | "digitalocean-droplet" | "firecracker" | "docker" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [externalConvexUrl, setExternalConvexUrl] = useState("");
  const [externalConvexDeployment, setExternalConvexDeployment] = useState("");
  const [connectingConvex, setConnectingConvex] = useState(false);
  const [showDisconnectConvex, setShowDisconnectConvex] = useState(false);
  const [disconnectingConvex, setDisconnectingConvex] = useState(false);
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [envVarsInitialized, setEnvVarsInitialized] = useState(false);
  const [savingEnvVars, setSavingEnvVars] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const [savingCustomPrompt, setSavingCustomPrompt] = useState(false);
  const { toast } = useToast();

  // Initialize envVars from repo data once loaded
  if (repo && !envVarsInitialized) {
    setEnvVars(repo.envVars ?? []);
    setEnvVarsInitialized(true);
  }

  if (repo === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-paper-400 border-t-white" />
        </div>
      </div>
    );
  }

  if (repo === null) notFound();

  const isOwner = repo.myRole === "owner";
  const currentPushStrategy = pushStrategy ?? repo.pushStrategy;
  const currentDefaultBranch = defaultBranch ?? repo.defaultBranch;
  const currentRuntime = runtime ?? repo.runtime ?? "webcontainer";
  const hasChanges =
    currentPushStrategy !== repo.pushStrategy ||
    currentDefaultBranch !== repo.defaultBranch ||
    currentRuntime !== (repo.runtime ?? "webcontainer");

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
        runtime: currentRuntime,
      });
      setPushStrategy(null);
      setDefaultBranch(null);
      setRuntime(null);
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

  async function handleConnectConvex(e: React.FormEvent) {
    e.preventDefault();
    if (!externalConvexUrl.trim() || !externalConvexDeployment.trim()) return;
    setConnectingConvex(true);
    try {
      await updateRepo({
        repoId,
        externalConvexUrl: externalConvexUrl.trim(),
        externalConvexDeployment: externalConvexDeployment.trim(),
      });
      setExternalConvexUrl("");
      setExternalConvexDeployment("");
      toast({ type: "success", message: "External Convex connected" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to connect Convex",
      });
    } finally {
      setConnectingConvex(false);
    }
  }

  async function handleDisconnectConvex() {
    setDisconnectingConvex(true);
    try {
      await updateRepo({ repoId, clearExternalConvex: true });
      toast({ type: "success", message: "External Convex disconnected" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to disconnect Convex",
      });
    } finally {
      setDisconnectingConvex(false);
      setShowDisconnectConvex(false);
    }
  }

  function handleAddEnvVar() {
    setEnvVars([...envVars, { key: "", value: "" }]);
  }

  function handleRemoveEnvVar(index: number) {
    setEnvVars(envVars.filter((_, i) => i !== index));
  }

  function handleEnvVarChange(index: number, field: "key" | "value", value: string) {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: value };
    setEnvVars(updated);
  }

  function parseEnvContent(content: string): Array<{ key: string; value: string }> {
    const lines = content.split(/\r?\n/);
    const parsed: Array<{ key: string; value: string }> = [];
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Match KEY=value pattern (value can be quoted or unquoted)
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const key = match[1];
        let value = match[2];
        // Check if value is quoted
        if ((value.startsWith('"') && value.includes('"', 1)) ||
            (value.startsWith("'") && value.includes("'", 1))) {
          // Extract quoted value (find closing quote)
          const quote = value[0];
          const endQuote = value.indexOf(quote, 1);
          value = value.slice(1, endQuote);
        } else {
          // Unquoted: strip inline comments and trailing whitespace
          const commentIndex = value.indexOf(" #");
          if (commentIndex !== -1) {
            value = value.slice(0, commentIndex);
          }
          value = value.trim();
        }
        parsed.push({ key, value });
      }
    }
    return parsed;
  }

  function handleEnvVarPaste(e: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const pastedText = e.clipboardData.getData("text");
    // Check if it looks like multiple env vars (has newlines or multiple KEY=value patterns)
    if (pastedText.includes("\n") || (pastedText.match(/=/g) || []).length > 1) {
      const parsed = parseEnvContent(pastedText);
      if (parsed.length > 0) {
        e.preventDefault();
        // Replace the current (likely empty) entry and add the rest
        const before = envVars.slice(0, index);
        const after = envVars.slice(index + 1);
        setEnvVars([...before, ...parsed, ...after]);
        toast({ type: "success", message: `Imported ${parsed.length} environment variable${parsed.length > 1 ? "s" : ""}` });
      }
    }
  }

  async function handleSaveEnvVars(e: React.FormEvent) {
    e.preventDefault();
    // Filter out empty entries
    const validEnvVars = envVars.filter((v) => v.key.trim() !== "");
    setSavingEnvVars(true);
    try {
      await updateRepo({ repoId, envVars: validEnvVars });
      setEnvVars(validEnvVars);
      toast({ type: "success", message: "Environment variables saved" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save environment variables",
      });
    } finally {
      setSavingEnvVars(false);
    }
  }

  const currentCustomPrompt = customPrompt ?? repo?.customPrompt ?? "";
  const customPromptChanged = currentCustomPrompt !== (repo?.customPrompt ?? "");

  async function handleSaveCustomPrompt(e: React.FormEvent) {
    e.preventDefault();
    setSavingCustomPrompt(true);
    try {
      await updateRepo({ repoId, customPrompt: currentCustomPrompt });
      setCustomPrompt(null);
      toast({ type: "success", message: "Custom prompt saved" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save custom prompt",
      });
    } finally {
      setSavingCustomPrompt(false);
    }
  }

  const envVarsChanged = JSON.stringify(envVars) !== JSON.stringify(repo?.envVars ?? []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/home"
        className="text-sm text-paper-600 hover:text-paper-800"
      >
        &larr; Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-paper-900">
        Repository Settings
      </h1>
      <p className="mt-1 text-sm text-paper-500">
        {repo.githubOwner}/{repo.githubRepo}
      </p>

      {/* Repo info */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-paper-800">Information</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
          <dl className="divide-y divide-paper-300">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Repository</dt>
              <dd className="text-sm font-medium text-paper-800">
                {repo.githubOwner}/{repo.githubRepo}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">GitHub URL</dt>
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
              <dt className="text-sm text-paper-600">Team</dt>
              <dd className="text-sm font-medium text-paper-800">
                {repo.teamName}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Connected</dt>
              <dd className="text-sm text-paper-800">
                {new Date(repo.connectedAt).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Runtime</dt>
              <dd className="text-sm font-medium text-paper-800">
                {(repo.runtime ?? "webcontainer") === "webcontainer"
                  ? "WebContainer (browser)"
                  : (repo.runtime ?? "webcontainer") === "sandpack"
                    ? "Sandpack (browser)"
                    : (repo.runtime ?? "webcontainer") === "digitalocean-droplet"
                      ? "DigitalOcean Droplet (server)"
                      : (repo.runtime ?? "webcontainer") === "firecracker"
                        ? "Firecracker VM (server)"
                        : "Fly.io Sprite (server)"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Edit form - only for owners */}
      {isOwner ? (
        <form onSubmit={handleSave} className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">Configuration</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
            <div className="space-y-4 p-4">
              <div>
                <label className="block text-sm font-medium text-paper-700">
                  Push Strategy
                </label>
                <div className="mt-2 flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="pushStrategy"
                      value="direct"
                      checked={currentPushStrategy === "direct"}
                      onChange={() => setPushStrategy("direct")}
                      className="accent-paper-700"
                    />
                    Direct push
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="pushStrategy"
                      value="pr"
                      checked={currentPushStrategy === "pr"}
                      onChange={() => setPushStrategy("pr")}
                      className="accent-paper-700"
                    />
                    Create PR
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-paper-700">
                  Runtime Environment
                </label>
                <p className="mt-0.5 text-xs text-paper-500">
                  Choose how code is executed for live previews
                </p>
                <div className="mt-2 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="webcontainer"
                      checked={currentRuntime === "webcontainer"}
                      onChange={() => setRuntime("webcontainer")}
                      className="accent-paper-700"
                    />
                    WebContainer (browser)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="sandpack"
                      checked={currentRuntime === "sandpack"}
                      onChange={() => setRuntime("sandpack")}
                      className="accent-paper-700"
                    />
                    Sandpack (browser)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="flyio-sprite"
                      checked={currentRuntime === "flyio-sprite"}
                      onChange={() => setRuntime("flyio-sprite")}
                      className="accent-paper-700"
                    />
                    Fly.io Sprite (server)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="digitalocean-droplet"
                      checked={currentRuntime === "digitalocean-droplet"}
                      onChange={() => setRuntime("digitalocean-droplet")}
                      className="accent-paper-700"
                    />
                    DigitalOcean Droplet (server)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="firecracker"
                      checked={currentRuntime === "firecracker"}
                      onChange={() => setRuntime("firecracker")}
                      className="accent-paper-700"
                    />
                    Firecracker VM (server)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-paper-700">
                    <input
                      type="radio"
                      name="runtime"
                      value="docker"
                      checked={currentRuntime === "docker"}
                      onChange={() => setRuntime("docker")}
                      className="accent-paper-700"
                    />
                    Docker (server)
                  </label>
                </div>
              </div>

              <div>
                <label
                  htmlFor="defaultBranch"
                  className="block text-sm font-medium text-paper-700"
                >
                  Default Branch
                </label>
                <input
                  id="defaultBranch"
                  type="text"
                  value={currentDefaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  className="mt-2 w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-paper-300 px-4 py-3">
              <button
                type="submit"
                disabled={saving || !hasChanges}
                className="rounded-md bg-paper-700 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50"
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
          <h2 className="text-lg font-semibold text-paper-800">Configuration</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200 p-4">
            <p className="text-sm text-paper-500">
              Only the team owner can edit repository settings.
            </p>
          </div>
        </div>
      )}

      {/* External Convex Application - only for owners */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">
            External Convex Application
          </h2>
          <p className="mt-1 text-sm text-paper-500">
            Connect an existing Convex deployment to enable full-stack
            development with a persistent backend.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
            {repo.externalConvexUrl && repo.externalConvexDeployment ? (
              <div className="p-4">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs font-medium text-paper-600">
                      Deployment URL
                    </dt>
                    <dd className="mt-0.5 text-sm text-paper-800">
                      {repo.externalConvexUrl}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-paper-600">
                      Deployment Name
                    </dt>
                    <dd className="mt-0.5 text-sm text-paper-800">
                      {repo.externalConvexDeployment}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <button
                    onClick={() => setShowDisconnectConvex(true)}
                    className="rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-900/30"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnectConvex} className="p-4">
                {(currentRuntime === "webcontainer" || currentRuntime === "sandpack") && (
                  <div className="mb-4 rounded-md border border-amber-800/50 bg-amber-900/20 px-3 py-2">
                    <p className="text-xs text-amber-400">
                      External Convex requires a server runtime. Switch to Fly.io
                      Sprite or DigitalOcean Droplet in the Configuration section above first.
                    </p>
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="convexUrl"
                      className="block text-sm font-medium text-paper-700"
                    >
                      Deployment URL
                    </label>
                    <input
                      id="convexUrl"
                      type="text"
                      value={externalConvexUrl}
                      onChange={(e) => setExternalConvexUrl(e.target.value)}
                      placeholder="https://your-project.convex.cloud"
                      className="mt-1 w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="convexDeployment"
                      className="block text-sm font-medium text-paper-700"
                    >
                      Deployment Name
                    </label>
                    <input
                      id="convexDeployment"
                      type="text"
                      value={externalConvexDeployment}
                      onChange={(e) =>
                        setExternalConvexDeployment(e.target.value)
                      }
                      placeholder="your-project-123"
                      className="mt-1 w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={
                      connectingConvex ||
                      !externalConvexUrl.trim() ||
                      !externalConvexDeployment.trim() ||
                      currentRuntime === "webcontainer" ||
                      currentRuntime === "sandpack"
                    }
                    className="rounded-md bg-paper-700 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50"
                  >
                    {connectingConvex ? "Connecting..." : "Connect"}
                  </button>
                </div>
                <p className="mt-3 text-xs text-paper-500">
                  Requires a server runtime (Fly.io Sprite or DigitalOcean Droplet). Browser-based runtimes
                  (WebContainer, Sandpack) do not support external Convex connections.
                </p>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Environment Variables - only for owners */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">
            Environment Variables
          </h2>
          <p className="mt-1 text-sm text-paper-500">
            Configure environment variables that will be injected into the runtime
            environment. These are used for server-side runtimes (Firecracker, DigitalOcean, Fly.io).
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
            <form onSubmit={handleSaveEnvVars} className="p-4">
              <div className="space-y-3">
                {envVars.map((envVar, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={envVar.key}
                      onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                      onPaste={(e) => handleEnvVarPaste(e, index)}
                      placeholder="KEY (paste .env here)"
                      className="w-1/3 rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 font-mono"
                    />
                    <span className="text-paper-500">=</span>
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                      placeholder="value"
                      className="flex-1 rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEnvVar(index)}
                      className="rounded-md p-2 text-paper-500 hover:bg-paper-300 hover:text-red-400"
                      title="Remove"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
                {envVars.length === 0 && (
                  <p className="text-sm text-paper-500 italic">
                    No environment variables configured.
                  </p>
                )}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddEnvVar}
                  className="rounded-md border border-paper-400 px-3 py-1.5 text-sm font-medium text-paper-700 hover:bg-paper-300"
                >
                  + Add Variable
                </button>
                {envVars.length > 0 && (
                  <button
                    type="submit"
                    disabled={savingEnvVars || !envVarsChanged}
                    className="rounded-md bg-paper-700 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50"
                  >
                    {savingEnvVars ? "Saving..." : "Save Variables"}
                  </button>
                )}
              </div>
              <p className="mt-3 text-xs text-paper-500">
                Common variables: NEXT_PUBLIC_CONVEX_URL, DATABASE_URL, API_KEY, etc.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Custom Prompt - only for owners */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">
            Custom Prompt
          </h2>
          <p className="mt-1 text-sm text-paper-500">
            Add custom instructions that will be appended to the AI system prompt for this repository.
            Use this to provide project-specific context, coding conventions, or constraints.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
            <form onSubmit={handleSaveCustomPrompt} className="p-4">
              <textarea
                value={currentCustomPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g. This is a Next.js app using Tailwind CSS. Always use server components by default. Use the app router conventions..."
                rows={6}
                className="w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 font-mono resize-y"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={savingCustomPrompt || !customPromptChanged}
                  className="rounded-md bg-paper-700 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50"
                >
                  {savingCustomPrompt ? "Saving..." : "Save Prompt"}
                </button>
                {customPromptChanged && (
                  <span className="text-xs text-paper-500">Unsaved changes</span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Danger zone - only for owners */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-red-900/50 bg-paper-200">
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-medium text-paper-800">
                  Disconnect Repository
                </p>
                <p className="mt-0.5 text-xs text-paper-500">
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

      <ConfirmDialog
        open={showDisconnectConvex}
        onClose={() => setShowDisconnectConvex(false)}
        onConfirm={handleDisconnectConvex}
        title="Disconnect External Convex?"
        description="Are you sure you want to disconnect the external Convex application? This will remove the deployment URL and name from this repository."
        confirmLabel="Disconnect"
        variant="danger"
        loading={disconnectingConvex}
      />
    </div>
  );
}
