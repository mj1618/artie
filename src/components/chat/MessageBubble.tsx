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
      <span className="mb-1 text-xs text-paper-600">
        {isUser ? "You" : "Artie"}
      </span>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "ml-auto bg-paper-300 text-paper-950"
            : "mr-auto bg-paper-700 text-paper-50 dark:bg-paper-300 dark:text-paper-900"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <>
            {content ? (
              <MarkdownContent content={content} />
            ) : streaming ? (
              <span className="text-paper-600">Thinking...</span>
            ) : null}
            {streaming && (
              <span className="inline-block animate-pulse text-paper-600">
                ▍
              </span>
            )}
          </>
        )}

        {changes && changes.files.length > 0 && (
          <div className="mt-2 border-t border-paper-800 pt-2 dark:border-paper-400">
            <span className="text-xs font-medium text-paper-500 dark:text-paper-600">
              Changed files:
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {changes.files.map((file) => (
                <span
                  key={file}
                  className="inline-block rounded bg-paper-800 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-paper-400 dark:text-paper-700"
                >
                  {file}
                </span>
              ))}
            </div>

            {!changes.committed && fileChangeId && !fileChangeData?.reverted && (
              <div className="mt-2">
                <button
                  onClick={() => setShowPushDialog(true)}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-paper-950 transition-colors hover:bg-green-500"
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
                  className="inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-paper-950 hover:bg-purple-500"
                >
                  View Pull Request
                </a>
              </div>
            )}

            {changes.committed && changes.commitSha && !changes.prUrl && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-xs font-medium text-paper-950">
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
      <span className="mt-1 text-xs text-paper-600">
        {formatTime(timestamp)}
      </span>
    </div>
  );
}
