"use client";

import { useState, useEffect, useRef } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/lib/useToast";

interface PushDialogProps {
  repoId: Id<"repos">;
  messageId: Id<"messages">;
  fileChangeId: Id<"fileChanges">;
  files: string[];
  messageContent: string;
  sessionBranch?: string;
  onClose: () => void;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .trim();
}

function getDefaultCommitMessage(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const firstLine = lines[0] ?? "Update files";
  return stripMarkdown(firstLine).slice(0, 72);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function getDefaultPrBody(content: string, files: string[]): string {
  const fileList = files.map((f) => `- \`${f}\``).join("\n");
  return `## Changes made by Composure\n\n${content}\n\n### Files changed\n${fileList}`;
}

export function PushDialog({
  repoId,
  messageId,
  fileChangeId,
  files,
  messageContent,
  sessionBranch,
  onClose,
}: PushDialogProps) {
  const repo = useQuery(api.projects.get, { repoId });
  const pushChanges = useAction(api.github.pushChanges);
  const dialogRef = useRef<HTMLDivElement>(null);

  const defaultCommit = getDefaultCommitMessage(messageContent);

  const [commitMessage, setCommitMessage] = useState(defaultCommit);
  const [branchName, setBranchName] = useState(
    sessionBranch ?? `artie/${slugify(defaultCommit)}`,
  );
  const [prTitle, setPrTitle] = useState(defaultCommit);
  const [prBody, setPrBody] = useState(getDefaultPrBody(messageContent, files));
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{
    commitSha: string;
    commitUrl?: string;
    prUrl?: string;
    branchName?: string;
  } | null>(null);
  const { toast } = useToast();

  const isPr = repo?.pushStrategy === "pr";

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handlePush = async () => {
    if (!commitMessage.trim()) {
      setError("Commit message is required");
      return;
    }
    if (isPr && !branchName.trim()) {
      setError("Branch name is required");
      return;
    }
    if (isPr && !prTitle.trim()) {
      setError("PR title is required");
      return;
    }

    setPushing(true);
    setError(null);
    try {
      const result = await pushChanges({
        repoId,
        messageId,
        fileChangeId,
        commitMessage: commitMessage.trim(),
        ...(isPr
          ? {
              branchName: branchName.trim(),
              prTitle: prTitle.trim(),
              prBody: prBody.trim(),
            }
          : {}),
      });
      setPushResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Push failed";
      setError(message);
    } finally {
      setPushing(false);
    }
  };

  const handleDone = () => {
    toast({
      type: "success",
      message: isPr
        ? "Pull request created"
        : `Changes pushed (${pushResult?.commitSha.slice(0, 7)})`,
    });
    onClose();
  };

  if (pushResult) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleDone();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg rounded-lg border border-paper-300 bg-paper-200 p-6 animate-dialog-in">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <svg
                className="h-6 w-6 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-semibold text-paper-900">
              Changes pushed successfully!
            </h3>
            <p className="mt-1 text-sm text-paper-600">
              {isPr
                ? `Pull request created on ${pushResult.branchName ?? branchName}`
                : `Committed to ${repo?.defaultBranch}`}
            </p>
            <p className="mt-2 font-mono text-xs text-paper-500">
              {pushResult.commitSha.slice(0, 7)}
            </p>
          </div>

          <div className="mt-4 flex justify-center gap-3">
            {pushResult.prUrl && (
              <a
                href={pushResult.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-paper-300 px-3 py-1.5 text-sm font-medium text-paper-800 hover:bg-paper-400"
              >
                View Pull Request
              </a>
            )}
            {!pushResult.prUrl && pushResult.commitUrl && (
              <a
                href={pushResult.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-paper-300 px-3 py-1.5 text-sm font-medium text-paper-800 hover:bg-paper-400"
              >
                View on GitHub
              </a>
            )}
            <button
              onClick={handleDone}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-paper-950 hover:bg-green-500"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (repo === undefined) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg rounded-lg border border-paper-300 bg-paper-200 p-6 animate-dialog-in">
          <div className="flex items-center justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (repo === null) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-lg rounded-lg border border-paper-300 bg-paper-200 p-6 animate-dialog-in">
          <p className="text-sm text-red-400">Repository not found.</p>
          <div className="mt-4 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-paper-600 hover:text-paper-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-paper-300 bg-paper-200 p-6 outline-none animate-dialog-in"
      >
        <h3 className="text-lg font-semibold text-paper-900">
          {isPr ? "Push Changes as Pull Request" : "Push Changes to GitHub"}
        </h3>
        <p className="mt-1 text-xs text-paper-600">
          {isPr
            ? `Creating a PR against ${repo.defaultBranch} on ${repo.githubOwner}/${repo.githubRepo}`
            : `Committing directly to ${repo.defaultBranch} on ${repo.githubOwner}/${repo.githubRepo}`}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-paper-600">
              Commit message
            </label>
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              maxLength={72}
              disabled={pushing}
              className="mt-1 w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-1.5 text-sm text-paper-900 placeholder-paper-500 focus:border-paper-500 focus:outline-none disabled:opacity-50"
              placeholder="Describe your changes..."
            />
            <span className="mt-0.5 block text-right text-xs text-paper-500">
              {commitMessage.length}/72
            </span>
          </div>

          {isPr && (
            <>
              <div>
                <label className="block text-xs font-medium text-paper-600">
                  Branch name
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  disabled={pushing}
                  className="mt-1 w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-1.5 font-mono text-sm text-paper-900 placeholder-paper-500 focus:border-paper-500 focus:outline-none disabled:opacity-50"
                  placeholder="artie/my-changes"
                />
                {sessionBranch && (
                  <p className="mt-1 text-xs text-blue-400">
                    Using the branch from your current session. Changes will be pushed to this branch.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-paper-600">
                  PR title
                </label>
                <input
                  type="text"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  disabled={pushing}
                  className="mt-1 w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-1.5 text-sm text-paper-900 placeholder-paper-500 focus:border-paper-500 focus:outline-none disabled:opacity-50"
                  placeholder="PR title..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-paper-600">
                  PR description
                </label>
                <textarea
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  rows={4}
                  disabled={pushing}
                  className="mt-1 w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-1.5 text-sm text-paper-900 placeholder-paper-500 focus:border-paper-500 focus:outline-none disabled:opacity-50"
                  placeholder="Describe the PR..."
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-paper-600">
              Files to commit
            </label>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-paper-400 bg-paper-300 p-2">
              {files.map((file) => (
                <div
                  key={file}
                  className="font-mono text-xs text-paper-700"
                >
                  {file}
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pushing}
            className="rounded-md px-3 py-1.5 text-sm text-paper-600 hover:text-paper-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePush}
            disabled={pushing}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-paper-950 hover:bg-green-500 disabled:opacity-50"
          >
            {pushing ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Pushing...
              </span>
            ) : (
              "Push"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
