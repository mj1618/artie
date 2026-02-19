"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
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
  imageIds?: Id<"_storage">[];
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

/**
 * Split assistant content into the primary explanation and a "thinking" section
 * that contains command logs, iteration fix notes, and intermediate status.
 */
function splitThinkingContent(content: string): {
  primary: string;
  thinking: string | null;
} {
  const commandsIdx = content.indexOf("**Commands run:**");
  if (commandsIdx !== -1) {
    const primary = content.slice(0, commandsIdx).trim();
    const thinking = content.slice(commandsIdx).trim();
    return { primary: primary || "Changes applied.", thinking };
  }

  const runningMatch = content.match(
    /\n\n\*(?:running commands|editing files|editing files, running commands)\.\.\.\*$/,
  );
  if (runningMatch && runningMatch.index !== undefined) {
    const primary = content.slice(0, runningMatch.index).trim();
    const thinking = content.slice(runningMatch.index).trim();
    return { primary: primary || "Working...", thinking };
  }

  return { primary: content, thinking: null };
}

function ThinkingBlock({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div className="mt-2 rounded border border-paper-600/30 dark:border-paper-400/30">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-paper-500 transition-colors hover:text-paper-300 dark:text-paper-600 dark:hover:text-paper-700"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {streaming ? "Working..." : "Commands & details"}
        {streaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
        )}
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto border-t border-paper-600/20 px-2 py-1.5 text-[11px] leading-relaxed text-paper-400 dark:border-paper-400/20 dark:text-paper-500"
        >
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

function MessageImage({ storageId }: { storageId: Id<"_storage"> }) {
  const url = useQuery(api.messages.getImageUrl, { storageId });
  if (!url) return <div className="h-40 w-40 animate-pulse rounded-md bg-zinc-200 dark:bg-paper-400" />;
  return (
    <img
      src={url}
      alt="Attached image"
      className="max-h-60 max-w-full rounded-md"
    />
  );
}

export function MessageBubble({
  messageId,
  role,
  content,
  timestamp,
  changes,
  imageIds,
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
        {isUser ? "You" : "Composure"}
      </span>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "ml-auto bg-paper-300 text-paper-950"
            : "mr-auto bg-paper-700 text-paper-50 dark:bg-paper-300 dark:text-paper-900"
        }`}
      >
        {isUser && imageIds && imageIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {imageIds.map((id) => (
              <MessageImage key={id} storageId={id} />
            ))}
          </div>
        )}
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <>
            {content ? (
              (() => {
                const { primary, thinking } = splitThinkingContent(content);
                return (
                  <>
                    <MarkdownContent content={primary} />
                    {thinking && (
                      <ThinkingBlock content={thinking} streaming={streaming} />
                    )}
                  </>
                );
              })()
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

            {changes.committed && changes.commitSha && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-xs font-medium text-paper-950">
                  Committed: {changes.commitSha.slice(0, 7)}
                </span>
              </div>
            )}
          </div>
        )}

      </div>
      <span className="mt-1 text-xs text-paper-600">
        {formatTime(timestamp)}
      </span>
    </div>
  );
}
