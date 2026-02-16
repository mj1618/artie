"use client";

import { useAction } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useToast } from "@/lib/useToast";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { CardSkeleton } from "@/components/ui/DashboardSkeleton";
import Link from "next/link";

type MergeMethod = "merge" | "squash" | "rebase";

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
  previousFilename?: string;
}

interface PRReview {
  user: string;
  state: string;
  body: string;
  submittedAt: string;
}

interface PRDetail {
  prNumber: number;
  title: string;
  body: string;
  state: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  merged: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  htmlUrl: string;
  repoFullName: string;
  files: PRFile[];
  reviews: PRReview[];
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    added: "bg-green-900/50 text-green-400",
    removed: "bg-red-900/50 text-red-400",
    modified: "bg-yellow-900/50 text-yellow-400",
    renamed: "bg-blue-900/50 text-blue-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? "bg-zinc-700 text-zinc-400"}`}
    >
      {status}
    </span>
  );
}

function PatchView({ patch }: { patch: string }) {
  if (!patch) {
    return (
      <div className="px-3 py-4 text-center text-xs text-zinc-500">
        Binary file or no diff available
      </div>
    );
  }

  const lines = patch.split("\n");

  return (
    <pre className="overflow-x-auto text-xs leading-relaxed">
      {lines.map((line, i) => {
        let className = "px-3 text-zinc-300";
        if (line.startsWith("@@")) {
          className =
            "px-3 bg-zinc-700/50 text-zinc-400";
        } else if (line.startsWith("+")) {
          className = "px-3 bg-green-950/30 text-green-300";
        } else if (line.startsWith("-")) {
          className = "px-3 bg-red-950/30 text-red-300";
        }
        return (
          <div key={i} className={className}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function ReviewBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    APPROVED: "bg-green-900/50 text-green-400",
    CHANGES_REQUESTED: "bg-red-900/50 text-red-400",
    COMMENTED: "bg-zinc-700 text-zinc-400",
    DISMISSED: "bg-zinc-700 text-zinc-400",
  };
  const labels: Record<string, string> = {
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes requested",
    COMMENTED: "Commented",
    DISMISSED: "Dismissed",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[state] ?? "bg-zinc-700 text-zinc-400"}`}
    >
      {labels[state] ?? state}
    </span>
  );
}

function MergeableIndicator({
  mergeable,
  mergeableState,
  merged,
}: {
  mergeable: boolean | null;
  mergeableState: string;
  merged: boolean;
}) {
  if (merged) {
    return (
      <span className="text-xs text-purple-400">Merged</span>
    );
  }
  if (mergeable === null) {
    return (
      <span className="text-xs text-yellow-400">Checking mergeability...</span>
    );
  }
  if (mergeable) {
    return (
      <span className="text-xs text-green-400">Ready to merge</span>
    );
  }
  return (
    <span className="text-xs text-red-400">
      {mergeableState === "dirty"
        ? "Has merge conflicts"
        : `Not mergeable (${mergeableState})`}
    </span>
  );
}

export default function PRReviewPage() {
  const params = useParams();
  const repoId = params.repoId as string;
  const prNumber = Number(params.prNumber);

  const getPRDetail = useAction(api.github.getPullRequestDetail);
  const mergePR = useAction(api.github.mergePullRequest);
  const approvePR = useAction(api.github.approvePullRequest);
  const { toast } = useToast();

  const [pr, setPr] = useState<PRDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [approving, setApproving] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"diff" | "preview">("diff");
  const [hasOpenedPreview, setHasOpenedPreview] = useState(false);

  const fetchPR = () => {
    setLoading(true);
    setError(null);
    getPRDetail({
      repoId: repoId as Id<"repos">,
      prNumber,
    })
      .then((data) => {
        setPr(data as PRDetail);
        // Expand all files by default
        setExpandedFiles(
          new Set((data as PRDetail).files.map((f) => f.filename)),
        );
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to load PR details";
        setError(message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPR();
  }, [repoId, prNumber]);

  const handleMerge = () => {
    setMerging(true);
    mergePR({
      repoId: repoId as Id<"repos">,
      prNumber,
      mergeMethod,
      deleteBranch,
    })
      .then((result) => {
        if (result.merged) {
          toast({ type: "success", message: "Pull request merged!" });
          fetchPR(); // Refresh to show merged state
        } else {
          toast({
            type: "error",
            message: result.message || "Failed to merge",
          });
        }
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to merge PR";
        toast({ type: "error", message });
      })
      .finally(() => setMerging(false));
  };

  const handleApprove = () => {
    setApproving(true);
    approvePR({
      repoId: repoId as Id<"repos">,
      prNumber,
    })
      .then(() => {
        toast({ type: "success", message: "PR approved" });
        fetchPR();
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to approve PR";
        toast({ type: "error", message });
      })
      .finally(() => setApproving(false));
  };

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <div className="h-4 w-32 rounded bg-zinc-800" />
        </div>
        <CardSkeleton lines={2} />
        <div className="mt-4 space-y-3">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/pull-requests"
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          &larr; Back to Pull Requests
        </Link>
        <div className="mt-6 rounded-lg border border-red-800/50 bg-red-900/10 p-4 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!pr) return null;

  const significantReviews = pr.reviews.filter(
    (r) => r.state !== "COMMENTED" && r.state !== "DISMISSED",
  );

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900 px-4">
        <Link
          href="/pull-requests"
          className="mr-4 text-sm text-zinc-400 hover:text-zinc-200"
        >
          &larr;
        </Link>
        <button
          onClick={() => setActiveTab("diff")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "diff"
              ? "border-b-2 border-blue-500 text-blue-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Diff ({pr.changedFiles} files)
        </button>
        <button
          onClick={() => {
            setActiveTab("preview");
            setHasOpenedPreview(true);
          }}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "preview"
              ? "border-b-2 border-blue-500 text-blue-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Live Preview
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          {pr.repoFullName} #{pr.prNumber}
        </span>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {/* Diff tab */}
        <div
          className={`h-full overflow-auto ${activeTab === "diff" ? "" : "hidden"}`}
        >
          <div className="mx-auto max-w-5xl px-6 py-10 pb-28">
            {/* Header */}
            <div>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold text-zinc-100">
                    {pr.title}{" "}
                    <span className="font-normal text-zinc-500">
                      #{pr.prNumber}
                    </span>
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        pr.merged
                          ? "bg-purple-900/50 text-purple-400"
                          : pr.state === "open"
                            ? "bg-green-900/50 text-green-400"
                            : "bg-red-900/50 text-red-400"
                      }`}
                    >
                      {pr.merged ? "Merged" : pr.state}
                    </span>
                    {pr.isDraft && (
                      <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                        Draft
                      </span>
                    )}
                    <span className="text-zinc-500">
                      {pr.author} wants to merge{" "}
                      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {pr.headBranch}
                      </code>{" "}
                      into{" "}
                      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {pr.baseBranch}
                      </code>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{pr.repoFullName}</span>
                    <span>
                      <span className="text-green-400">+{pr.additions}</span>{" "}
                      <span className="text-red-400">-{pr.deletions}</span>
                    </span>
                    <span>{pr.changedFiles} files changed</span>
                    <a
                      href={pr.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300"
                    >
                      View on GitHub
                    </a>
                  </div>
                </div>
                {pr.authorAvatar && (
                  <img
                    src={pr.authorAvatar}
                    alt={pr.author}
                    className="h-10 w-10 rounded-full"
                  />
                )}
              </div>
            </div>

            {/* PR Body */}
            {pr.body && (
              <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-semibold text-zinc-300">
                  Description
                </h2>
                <div className="text-sm text-zinc-300">
                  <MarkdownContent content={pr.body} />
                </div>
              </div>
            )}

            {/* Reviews */}
            {significantReviews.length > 0 && (
              <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-semibold text-zinc-300">Reviews</h2>
                <div className="space-y-2">
                  {significantReviews.map((review, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-300">{review.user}</span>
                      <ReviewBadge state={review.state} />
                      {review.body && (
                        <span className="truncate text-xs text-zinc-500">
                          {review.body}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File changes */}
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold text-zinc-300">
                Changed files ({pr.files.length})
              </h2>
              <div className="space-y-2">
                {pr.files.map((file) => {
                  const isExpanded = expandedFiles.has(file.filename);
                  return (
                    <div
                      key={file.filename}
                      className="overflow-hidden rounded-lg border border-zinc-800"
                    >
                      <button
                        onClick={() => toggleFile(file.filename)}
                        className="flex w-full items-center gap-2 bg-zinc-900 px-3 py-2 text-left text-sm hover:bg-zinc-800/50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`shrink-0 text-zinc-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        <span className="truncate font-mono text-xs text-zinc-300">
                          {file.previousFilename
                            ? `${file.previousFilename} → ${file.filename}`
                            : file.filename}
                        </span>
                        <StatusBadge status={file.status} />
                        <span className="ml-auto shrink-0 text-xs">
                          <span className="text-green-400">+{file.additions}</span>{" "}
                          <span className="text-red-400">-{file.deletions}</span>
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-zinc-800 bg-zinc-950">
                          <PatchView patch={file.patch} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sticky merge controls */}
            {!pr.merged && pr.state === "open" && (
              <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur">
                <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-4">
                    <MergeableIndicator
                      mergeable={pr.mergeable}
                      mergeableState={pr.mergeableState}
                      merged={pr.merged}
                    />
                    <label className="flex items-center gap-2 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={deleteBranch}
                        onChange={(e) => setDeleteBranch(e.target.checked)}
                        className="rounded border-zinc-600 bg-zinc-800"
                      />
                      Delete branch after merge
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="rounded-md border border-green-600 px-3 py-1.5 text-sm font-medium text-green-400 hover:bg-green-600/10 disabled:opacity-50"
                    >
                      {approving ? "Approving..." : "Approve"}
                    </button>
                    <select
                      value={mergeMethod}
                      onChange={(e) => setMergeMethod(e.target.value as MergeMethod)}
                      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-300"
                    >
                      <option value="merge">Create merge commit</option>
                      <option value="squash">Squash and merge</option>
                      <option value="rebase">Rebase and merge</option>
                    </select>
                    <button
                      onClick={handleMerge}
                      disabled={merging || pr.mergeable === false}
                      className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {merging ? "Merging..." : "Merge"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview tab - only render once user has opened it */}
        {hasOpenedPreview && (
          <div
            className={`h-full ${activeTab === "preview" ? "" : "hidden"}`}
          >
            <PreviewPanel
              repoId={repoId as Id<"repos">}
              sessionId={null}
              branch={pr.headBranch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
