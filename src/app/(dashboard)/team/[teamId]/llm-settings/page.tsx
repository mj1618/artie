"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";

const MODEL_OPTIONS: Record<string, { label: string; value: string }[]> = {
  openai: [
    { label: "GPT-5.2 Codex", value: "gpt-5.2-codex" },
    { label: "GPT-4", value: "gpt-4" },
    { label: "GPT-4 Turbo", value: "gpt-4-turbo" },
    { label: "GPT-3.5 Turbo", value: "gpt-3.5-turbo" },
  ],
  anthropic: [
    { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
    { label: "Claude 3 Haiku", value: "claude-3-haiku-20240307" },
  ],
  google: [
    { label: "Gemini Pro", value: "gemini-pro" },
    { label: "Gemini 1.5 Pro", value: "gemini-1.5-pro" },
  ],
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

export default function LlmSettingsPage() {
  const params = useParams();
  const teamId = params.teamId as Id<"teams">;
  const team = useQuery(api.teams.getTeam, { teamId });
  const llmSettings = useQuery(api.teams.getLlmSettings, { teamId });
  const updateLlmSettings = useMutation(api.teams.updateLlmSettings);

  const [provider, setProvider] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (llmSettings && !initialized) {
      setProvider(llmSettings.llmProvider ?? "");
      setModel(llmSettings.llmModel ?? "");
      setInitialized(true);
    }
  }, [llmSettings, initialized]);

  if (team === undefined || llmSettings === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
        </div>
      </div>
    );
  }

  if (team === null || llmSettings === null) {
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
            Not authorized. Only team owners can access LLM settings.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = team.myRole === "owner";
  const hasCustomProvider = !!provider;
  const models = provider ? MODEL_OPTIONS[provider] ?? [] : [];

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateLlmSettings({
        teamId,
        llmProvider: provider as "openai" | "anthropic" | "google" | undefined,
        llmApiKey: apiKey || undefined,
        llmModel: model || undefined,
      });
      setApiKey("");
      setSaved(true);
      setInitialized(false);
      setTimeout(() => setSaved(false), 2000);
      toast({ type: "success", message: "LLM settings saved" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save settings";
      setError(msg);
      toast({ type: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateLlmSettings({ teamId });
      setProvider("");
      setApiKey("");
      setModel("");
      setSaved(true);
      setInitialized(false);
      setTimeout(() => setSaved(false), 2000);
      toast({ type: "success", message: "LLM settings reset to defaults" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reset settings";
      setError(msg);
      toast({ type: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href={`/team/${teamId}`}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back to team
        </Link>
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            Only the team owner can manage LLM settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/team/${teamId}`}
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        &larr; Back to team
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-zinc-100">LLM Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Configure a custom LLM provider for {team.name}
      </p>

      {/* Current Configuration */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">
          Current Configuration
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <dl className="divide-y divide-zinc-800">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">Provider</dt>
              <dd className="text-sm font-medium text-zinc-200">
                {llmSettings.llmProvider
                  ? PROVIDER_LABELS[llmSettings.llmProvider] ?? llmSettings.llmProvider
                  : "Platform Default (OpenAI Codex)"}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">Model</dt>
              <dd className="text-sm font-medium text-zinc-200">
                {llmSettings.llmModel ?? "gpt-5.2-codex"}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-zinc-400">API Key</dt>
              <dd className="text-sm font-medium text-zinc-200">
                {llmSettings.hasApiKey ? (
                  <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">
                    Set
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    Using platform default
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleSave} className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-200">
          Update Configuration
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <div className="space-y-4 p-4">
            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-zinc-300">
                Provider
              </label>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="radio"
                    name="provider"
                    value=""
                    checked={!provider}
                    onChange={() => {
                      setProvider("");
                      setModel("");
                    }}
                    className="accent-zinc-100"
                  />
                  Platform Default
                </label>
                {(["openai", "anthropic", "google"] as const).map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-2 text-sm text-zinc-300"
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={p}
                      checked={provider === p}
                      onChange={() => {
                        setProvider(p);
                        setModel(MODEL_OPTIONS[p][0]?.value ?? "");
                      }}
                      className="accent-zinc-100"
                    />
                    {PROVIDER_LABELS[p]}
                  </label>
                ))}
              </div>
            </div>

            {/* API Key */}
            {hasCustomProvider && (
              <div>
                <label
                  htmlFor="apiKey"
                  className="block text-sm font-medium text-zinc-300"
                >
                  API Key
                </label>
                <input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    llmSettings.hasApiKey
                      ? "Key is set — enter a new key to update"
                      : "Enter your API key"
                  }
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Your API key is stored securely and never exposed to the
                  browser.
                </p>
              </div>
            )}

            {/* Model Selection */}
            {hasCustomProvider && models.length > 0 && (
              <div>
                <label
                  htmlFor="model"
                  className="block text-sm font-medium text-zinc-300"
                >
                  Model
                </label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                >
                  {models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {(llmSettings.llmProvider || llmSettings.hasApiKey) && (
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
              >
                Reset to Default
              </button>
            )}
            {saved && (
              <span className="text-sm text-emerald-400">Saved</span>
            )}
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      </form>
    </div>
  );
}
