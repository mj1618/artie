"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Id } from "../../../convex/_generated/dataModel";

interface Message {
  _id: Id<"messages">;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
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
  onRetryFileChange?: (fileChangeId: Id<"fileChanges">) => void;
}

export function MessageList({
  messages,
  repoId,
  fileChangesByMessageId,
  sessionBranch,
  onRetryFileChange,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasStreaming = messages.some((m) => m.streaming);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, hasStreaming, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center text-sm text-zinc-400">
          Start a conversation to preview and edit your code
        </p>
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
          repoId={repoId}
          fileChangeId={fileChangesByMessageId[message._id]}
          streaming={message.streaming}
          sessionBranch={sessionBranch}
          onRetryFileChange={onRetryFileChange}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
