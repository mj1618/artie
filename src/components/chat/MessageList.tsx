"use client";

import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Id } from "../../../convex/_generated/dataModel";

interface Message {
  _id: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
  imageIds?: Id<"_storage">[];
  changes?: {
    files: string[];
    committed: boolean;
    commitSha?: string;
    prUrl?: string;
  };
}

interface MessageListProps {
  messages: Message[];
  repoId: Id<"repos">;
  fileChangesByMessageId: Record<string, Id<"fileChanges">>;
  sessionBranch?: string;
  sessionFeatureName?: string;
  onRetryFileChange?: (fileChangeId: Id<"fileChanges">) => void;
  isGenerating?: boolean;
}

export function MessageList({
  messages,
  repoId,
  fileChangesByMessageId,
  sessionBranch,
  sessionFeatureName,
  onRetryFileChange,
  isGenerating,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasStreaming = messages.some((m) => m.streaming);
  const [showFinished, setShowFinished] = useState(false);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (hasStreaming) {
      wasStreamingRef.current = true;
      setShowFinished(false);
    } else if (wasStreamingRef.current) {
      wasStreamingRef.current = false;
      setShowFinished(true);
    }
  }, [hasStreaming]);

  // Also hide when a new generation starts
  useEffect(() => {
    if (isGenerating) {
      setShowFinished(false);
    }
  }, [isGenerating]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, hasStreaming, showFinished, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="max-w-sm text-center">
          {sessionFeatureName ? (
            <>
              <p className="text-sm font-medium text-paper-700 dark:text-paper-600">
                Working on: <span className="text-paper-900 dark:text-paper-800">{sessionFeatureName}</span>
              </p>
              <p className="mt-2 text-sm text-paper-500">
                Describe what you want to build and I&apos;ll help you make it happen.
              </p>
            </>
          ) : (
            <p className="text-sm text-paper-600">
              Start a conversation to preview and edit your code
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageBubble
          key={message._id}
          messageId={message._id}
          role={message.role}
          content={message.content}
          timestamp={message.timestamp}
          changes={message.changes}
          imageIds={message.imageIds}
          repoId={repoId}
          fileChangeId={fileChangesByMessageId[message._id]}
          streaming={message.streaming}
          sessionBranch={sessionBranch}
          onRetryFileChange={onRetryFileChange}
        />
      ))}
      {showFinished && (
        <div className="flex items-center justify-center gap-2 py-2">
          <div className="h-px flex-1 bg-paper-600/20 dark:bg-paper-400/20" />
          <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.15-.043l4.25-5.5Z" clipRule="evenodd" />
            </svg>
            Finished
          </span>
          <div className="h-px flex-1 bg-paper-600/20 dark:bg-paper-400/20" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
