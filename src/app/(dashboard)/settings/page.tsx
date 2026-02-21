"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { useToast } from "@/lib/useToast";
import {
  PageHeaderSkeleton,
  CardSkeleton,
} from "@/components/ui/DashboardSkeleton";

function GitHubConnection() {
  const profile = useQuery(api.users.getProfile);
  const connectGithubMutation = useMutation(api.users.connectGithub);
  const disconnectGithubMutation = useMutation(api.users.disconnectGithub);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState(false);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    const token = searchParams.get("github_token");
    const username = searchParams.get("github_username");
    const refreshToken = searchParams.get("github_refresh_token");
    const tokenExpiresAt = searchParams.get("github_token_expires_at");
    const error = searchParams.get("error");

    if (token && username) {
      handledRef.current = true;
      connectGithubMutation({
        githubAccessToken: token,
        githubUsername: username,
        githubRefreshToken: refreshToken ?? undefined,
        githubTokenExpiresAt: tokenExpiresAt ? parseInt(tokenExpiresAt, 10) : undefined,
      })
        .then(() => {
          toast({ type: "success", message: `Connected as ${username}` });
          router.replace("/settings");
        })
        .catch(() => {
          toast({ type: "error", message: "Failed to save GitHub connection" });
          router.replace("/settings");
        });
    } else if (error) {
      handledRef.current = true;
      toast({ type: "error", message: "GitHub connection failed. Please try again." });
      router.replace("/settings");
    }
  }, [searchParams, connectGithubMutation, toast, router]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectGithubMutation();
      toast({ type: "success", message: "GitHub disconnected" });
    } catch {
      toast({ type: "error", message: "Failed to disconnect GitHub" });
    } finally {
      setDisconnecting(false);
    }
  }

  if (profile === undefined) return <CardSkeleton lines={2} />;

  const isConnected = !!profile?.githubUsername;

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-200 p-6">
      <h2 className="text-lg font-semibold text-paper-800">GitHub Connection</h2>
      <p className="mt-1 text-sm text-paper-500">
        Connect your GitHub account to access private repos and push changes.
      </p>
      {isConnected ? (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-sm text-green-400">
              Connected as <strong>{profile?.githubUsername}</strong>
            </span>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="rounded-md border border-paper-400 px-3 py-1.5 text-sm font-medium text-paper-700 hover:bg-paper-300 hover:text-paper-950 disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <a
          href="/api/github/authorize"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-paper-300 px-4 py-2 text-sm font-medium text-paper-900 hover:bg-paper-400"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Connect GitHub
        </a>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-6 py-10">
          <PageHeaderSkeleton />
          <div className="mt-8 space-y-6">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={2} />
          </div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const user = useQuery(api.users.currentUser);
  const profile = useQuery(api.users.getProfile);
  const updateProfile = useMutation(api.users.updateProfile);
  const { signOut } = useClerk();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (profile?.displayName) {
      setDisplayName(profile.displayName);
    }
  }, [profile?.displayName]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateProfile({ displayName: name });
      setSaved(true);
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

  async function handleSignOut() {
    await signOut({ redirectUrl: "/login" });
  }

  if (user === undefined || profile === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeaderSkeleton />
        <div className="mt-8 space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold text-paper-900">Account Settings</h1>
      <p className="mt-1 text-sm text-paper-500">
        Manage your profile and account preferences.
      </p>

      {/* Profile Section */}
      <div className="mt-8 rounded-lg border border-paper-300 bg-paper-200 p-6">
        <h2 className="text-lg font-semibold text-paper-800">Profile</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-paper-600">
              Email
            </label>
            <p className="mt-1 text-sm text-paper-800">
              {user?.email ?? "\u2014"}
            </p>
          </div>

          <form onSubmit={handleSave}>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium text-paper-600"
            >
              Display Name
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaved(false);
                }}
                placeholder="Your display name"
                className="flex-1 rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
              />
              <button
                type="submit"
                disabled={saving || !displayName.trim()}
                className="rounded-md bg-paper-700 px-3 py-2 text-sm font-medium text-paper-5000 hover:bg-zinc-200 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            {saved && (
              <p className="mt-2 text-sm text-green-400">Profile updated.</p>
            )}
          </form>
        </div>
      </div>

      {/* GitHub Connection Section */}
      <div className="mt-6">
        <GitHubConnection />
      </div>

      {/* Account Section */}
      <div className="mt-6 rounded-lg border border-paper-300 bg-paper-200 p-6">
        <h2 className="text-lg font-semibold text-paper-800">Account</h2>
        <p className="mt-2 text-sm text-paper-600">
          Signed in as{" "}
          <span className="text-paper-800">{user?.email ?? "\u2014"}</span>
        </p>
        <button
          onClick={handleSignOut}
          className="mt-4 rounded-md border border-paper-400 px-4 py-2 text-sm font-medium text-paper-700 hover:bg-paper-300 hover:text-paper-950"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
