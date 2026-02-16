"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { ChangePreview } from "@/components/chat/ChangePreview";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { PushDialog } from "@/components/chat/PushDialog";

interface Changes {
  files: string[];
  committed: boolean;
  commitSha?: string;
  prUrl?: string;
}

interface MessageBubbleProps {
  messageId: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  changes?: Changes;
  repoId: Id<"repos">;
  fileChangeId?: Id<"fileChanges">;
  streaming?: boolean;
  sessionBranch?: string;
  onRetryFileChange?: (fileChangeId: Id<"fileChanges">) => void;
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function MessageBubble({
  messageId,
  role,
  content,
  timestamp,
  changes,
  repoId,
  fileChangeId,
  streaming,
  sessionBranch,
  onRetryFileChange,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [showPushDialog, setShowPushDialog] = useState(false);
  const fileChangeData = useQuery(
    api.fileChanges.getByMessage,
    !isUser && changes ? { messageId } : "skip",
  );

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <span className="mb-1 text-xs text-zinc-400">
        {isUser ? "You" : "Artie"}
      </span>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "ml-auto bg-zinc-800 text-white"
            : "mr-auto bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <>
            {content ? (
              <MarkdownContent content={content} />
            ) : streaming ? (
              <span className="text-zinc-400">Thinking...</span>
            ) : null}
            {streaming && (
              <span className="inline-block animate-pulse text-zinc-400">
                ▍
              </span>
            )}
          </>
        )}

        {changes && changes.files.length > 0 && (
          <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Changed files:
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {changes.files.map((file) => (
                <span
                  key={file}
                  className="inline-block rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                >
                  {file}
                </span>
              ))}
            </div>

            {!changes.committed && fileChangeId && !fileChangeData?.reverted && (
              <div className="mt-2">
                <button
                  onClick={() => setShowPushDialog(true)}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-500"
                >
                  Approve & Push to GitHub
                </button>
                {showPushDialog && (
                  <PushDialog
                    repoId={repoId}
                    messageId={messageId}
                    fileChangeId={fileChangeId}
                    files={changes.files}
                    messageContent={content}
                    sessionBranch={sessionBranch}
                    onClose={() => setShowPushDialog(false)}
                  />
                )}
              </div>
            )}

            {changes.committed && changes.prUrl && (
              <div className="mt-2">
                <a
                  href={changes.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-500"
                >
                  View Pull Request
                </a>
              </div>
            )}

            {changes.committed && changes.commitSha && !changes.prUrl && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-xs font-medium text-white">
                  Committed: {changes.commitSha.slice(0, 7)}
                </span>
              </div>
            )}
          </div>
        )}

        {fileChangeData && (
          <ChangePreview
            files={fileChangeData.files}
            fileChangeId={fileChangeData._id}
            reverted={fileChangeData.reverted ?? false}
            committed={changes?.committed}
            error={fileChangeData.error}
            onRetry={onRetryFileChange ? () => onRetryFileChange(fileChangeData._id) : undefined}
          />
        )}
      </div>
      <span className="mt-1 text-xs text-zinc-400">
        {formatTime(timestamp)}
      </span>
    </div>
  );
}
