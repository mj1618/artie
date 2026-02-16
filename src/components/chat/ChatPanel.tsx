"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { MessageList } from "@/components/chat/MessageList";
import { SessionPicker } from "@/components/chat/SessionPicker";
import { getWebContainer } from "@/lib/webcontainer/index";
import { writeFile } from "@/lib/webcontainer/files";
import { useToast } from "@/lib/useToast";

export function ChatPanel({
  repoId,
  sessions,
  initialSessionId,
  onSessionChange,
  onNewChatRequest,
  pendingBranchInfo,
}: {
  repoId: Id<"repos">;
  sessions: Doc<"sessions">[];
  initialSessionId: Id<"sessions"> | null;
  onSessionChange?: (sessionId: Id<"sessions"> | null) => void;
  onNewChatRequest?: () => void;
  pendingBranchInfo?: { branchName: string; featureName: string } | null;
}) {
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(
    initialSessionId,
  );
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const createSession = useMutation(api.sessions.create);
  const deleteSessionMutation = useMutation(api.sessions.deleteSession);
  const renameSessionMutation = useMutation(api.sessions.renameSession);
  const sendMessage = useMutation(api.messages.send);
  const generateResponse = useAction(api.ai.generateResponse);
  const markApplied = useMutation(api.fileChanges.markApplied);
  const markFailed = useMutation(api.fileChanges.markFailed);
  const clearFileChangeError = useMutation(api.fileChanges.clearError);
  const messages = useQuery(
    api.messages.list,
    sessionId ? { sessionId } : "skip",
  );
  const latestChange = useQuery(
    api.fileChanges.getFileChanges,
    sessionId ? { sessionId } : "skip",
  );
  const allFileChanges = useQuery(
    api.fileChanges.listBySession,
    sessionId ? { sessionId } : "skip",
  );

  const fileChangesByMessageId = useMemo(() => {
    const map: Record<string, Id<"fileChanges">> = {};
    if (allFileChanges) {
      for (const fc of allFileChanges) {
        map[fc.messageId] = fc._id;
      }
    }
    return map;
  }, [allFileChanges]);

  // Sync when initialSessionId changes from parent
  useEffect(() => {
    setSessionId(initialSessionId);
  }, [initialSessionId]);

  // Apply file changes to WebContainer when they arrive
  useEffect(() => {
    if (!latestChange || latestChange.applied || latestChange.reverted || latestChange.error) return;

    async function applyChanges() {
      try {
        const container = await getWebContainer();
        for (const file of latestChange!.files) {
          await writeFile(container, file.path, file.content);
        }
        await markApplied({ fileChangeId: latestChange!._id });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error("Failed to apply file changes to WebContainer:", err);
        toast({
          type: "error",
          message: "Failed to apply changes to the preview. Try refreshing the preview.",
        });
        await markFailed({
          fileChangeId: latestChange!._id,
          error: errorMsg,
        }).catch(() => {});
      }
    }

    applyChanges();
  }, [latestChange, markApplied, markFailed, toast]);

  const retryApplyChanges = async (fileChangeId: Id<"fileChanges">) => {
    try {
      await clearFileChangeError({ fileChangeId });
    } catch (err) {
      toast({
        type: "error",
        message: "Failed to retry. Please refresh the page.",
      });
    }
  };

  const handleSelectSession = (id: Id<"sessions">) => {
    setSessionId(id);
    onSessionChange?.(id);
  };

  const handleNewChat = () => {
    if (onNewChatRequest) {
      onNewChatRequest();
    } else {
      setSessionId(null);
      onSessionChange?.(null);
    }
  };

  const handleDeleteSession = async (id: Id<"sessions">) => {
    const isActive = id === sessionId;
    await deleteSessionMutation({ sessionId: id });
    if (isActive) {
      // Switch to the most recent remaining session, or null
      const remaining = sessions.filter((s) => s._id !== id);
      if (remaining.length > 0) {
        const next = remaining[0]; // sessions are sorted desc by lastActiveAt
        setSessionId(next._id);
        onSessionChange?.(next._id);
      } else {
        setSessionId(null);
        onSessionChange?.(null);
      }
    }
  };

  const handleRenameSession = async (
    id: Id<"sessions">,
    name: string,
  ) => {
    await renameSessionMutation({ sessionId: id, name });
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setInput("");
    resetTextareaHeight();
    try {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        currentSessionId = await createSession({
          repoId,
          branchName: pendingBranchInfo?.branchName,
          featureName: pendingBranchInfo?.featureName,
        });
        setSessionId(currentSessionId);
        onSessionChange?.(currentSessionId);
      }
      await sendMessage({
        sessionId: currentSessionId,
        role: "user",
        content: trimmed,
      });
      await generateResponse({ sessionId: currentSessionId });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to get AI response",
      });
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = input.trim().length > 0 && !sending;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900">
      <SessionPicker
        sessions={sessions}
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />
      <MessageList
        messages={messages ?? []}
        repoId={repoId}
        fileChangesByMessageId={fileChangesByMessageId}
        sessionBranch={sessions.find((s) => s._id === sessionId)?.branchName}
        onRetryFileChange={retryApplyChanges}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="border-t border-zinc-200 p-3 dark:border-zinc-700"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you'd like to change..."
            disabled={sending}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95l14.095-5.638a.75.75 0 0 0 0-1.398L3.105 2.289Z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
