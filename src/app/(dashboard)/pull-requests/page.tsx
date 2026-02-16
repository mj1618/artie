"use client";

import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import { useToast } from "@/lib/useToast";
import { CardSkeleton } from "@/components/ui/DashboardSkeleton";
import Link from "next/link";

interface PullRequest {
  repoId: string;
  repoFullName: string;
  teamName: string;
  prNumber: number;
  title: string;
  body: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  htmlUrl: string;
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function PRCard({ pr }: { pr: PullRequest }) {
  return (
    <Link
      href={`/pull-requests/${pr.repoId}/${pr.prNumber}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">
              {pr.title}
            </span>
            {pr.isDraft && (
              <span className="shrink-0 rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                Draft
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-medium text-zinc-400">
              {pr.repoFullName}
            </span>
            <span>#{pr.prNumber}</span>
            <span>·</span>
            <span>{pr.author}</span>
            <span>·</span>
            <span>updated {timeAgo(pr.updatedAt)}</span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500">
            <span>
              {pr.headBranch} → {pr.baseBranch}
            </span>
          </div>
        </div>
        {pr.authorAvatar && (
          <img
            src={pr.authorAvatar}
            alt={pr.author}
            className="h-6 w-6 shrink-0 rounded-full"
          />
        )}
      </div>
    </Link>
  );
}

export default function PullRequestsPage() {
  const listPRs = useAction(api.github.listOpenPullRequests);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchPRs = () => {
    setLoading(true);
    setError(null);
    listPRs({})
      .then(setPrs)
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to load pull requests";
        setError(message);
        toast({ type: "error", message: "Failed to load pull requests" });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPRs();
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Pull Requests</h1>
        <button
          onClick={fetchPRs}
          disabled={loading}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="mt-6 space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-lg border border-red-800/50 bg-red-900/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {prs && !loading && prs.length === 0 && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          No open pull requests across your connected repositories.
        </div>
      )}

      {prs && !loading && prs.length > 0 && (
        <div className="mt-6 space-y-3">
          {prs.map((pr) => (
            <PRCard key={`${pr.repoFullName}-${pr.prNumber}`} pr={pr} />
          ))}
        </div>
      )}
    </div>
  );
}
