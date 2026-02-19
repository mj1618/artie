"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { MessageList } from "@/components/chat/MessageList";
import { SessionPicker } from "@/components/chat/SessionPicker";
import { getWebContainer } from "@/lib/webcontainer/index";
import { writeFile } from "@/lib/webcontainer/files";
import { runCommand } from "@/lib/webcontainer/runCommand";
import { useToast } from "@/lib/useToast";

type Runtime = "webcontainer" | "flyio-sprite" | "sandpack" | "digitalocean-droplet" | "firecracker" | "docker" | undefined;

type SessionStatus = "empty" | "has_changes" | "pushed" | "pr_open";
type SessionWithStatus = Doc<"sessions"> & { status: SessionStatus };

export function ChatPanel({
  repoId,
  sessions,
  initialSessionId,
  onSessionChange,
  onNewChatRequest,
  pendingBranchInfo,
}: {
  repoId: Id<"repos">;
  sessions: SessionWithStatus[];
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
  const [pendingImages, setPendingImages] = useState<
    { file: File; previewUrl: string }[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const applyingFileChangeRef = useRef<string | null>(null);
  const { toast } = useToast();

  const createSession = useMutation(api.sessions.create);
  const deleteSessionMutation = useMutation(api.sessions.deleteSession);
  const renameSessionMutation = useMutation(api.sessions.renameSession);
  const requestStop = useMutation(api.sessions.requestStop);
  const sendMessage = useMutation(api.messages.send);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const generateResponse = useAction(api.ai.generateResponse);
  const generateResponseViaCli = useAction(api.ai.generateResponseViaCli);
  const markApplied = useMutation(api.fileChanges.markApplied);
  const markFailed = useMutation(api.fileChanges.markFailed);
  const clearFileChangeError = useMutation(api.fileChanges.clearError);
  const markCommandRunning = useMutation(api.bashCommands.markRunning);
  const markCommandCompleted = useMutation(api.bashCommands.markCompleted);
  const markCommandFailed = useMutation(api.bashCommands.markFailed);
  
  // Sprite actions for Fly.io runtime
  const applyFileChangesToSprite = useAction(api.spriteFiles.applyFileChanges);
  
  // Droplet actions for DigitalOcean runtime
  const applyFileChangesToDroplet = useAction(api.dropletFiles.applyFileChanges);

  // Firecracker actions for Firecracker runtime
  const applyFileChangesToFirecracker = useAction(api.firecrackerFiles.applyFileChanges);

  // Docker actions for Docker runtime
  const applyFileChangesToDocker = useAction(api.dockerFiles.applyFileChanges);
  
  // Query repo to get runtime type
  const repo = useQuery(api.projects.get, { repoId });
  const runtime: Runtime = repo?.runtime;
  
  // Query sprite for this session (only if using flyio-sprite runtime)
  const sprite = useQuery(
    api.flyioSprites.getBySession,
    sessionId && runtime === "flyio-sprite" ? { sessionId } : "skip",
  );
  
  // Query droplet for this session (only if using digitalocean-droplet runtime)
  const droplet = useQuery(
    api.droplets.getBySession,
    sessionId && runtime === "digitalocean-droplet" ? { sessionId } : "skip",
  );

  // Query Firecracker VM for this session (only if using firecracker runtime)
  const firecrackerVm = useQuery(
    api.firecrackerVms.getForPreview,
    sessionId && runtime === "firecracker"
      ? { sessionId, repoId, branch: sessions.find((s) => s._id === sessionId)?.branchName }
      : "skip",
  );

  // Query Docker container for this session (only if using docker runtime)
  const dockerContainer = useQuery(
    api.dockerContainers.getForSession,
    sessionId && runtime === "docker" ? { sessionId } : "skip",
  );
  
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
  const pendingCommand = useQuery(
    api.bashCommands.getPendingCommand,
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

  // Apply file changes to WebContainer, Fly.io Sprite, or DigitalOcean Droplet when they arrive
  useEffect(() => {
    if (!latestChange || latestChange.applied || latestChange.reverted || latestChange.error) return;

    // Wait for the container/VM query to load before attempting to apply
    if (runtime === "docker" && dockerContainer === undefined) return;
    if (runtime === "firecracker" && firecrackerVm === undefined) return;
    if (runtime === "flyio-sprite" && sprite === undefined) return;
    if (runtime === "digitalocean-droplet" && droplet === undefined) return;

    // Prevent duplicate apply calls for the same file change
    if (applyingFileChangeRef.current === latestChange._id) return;
    applyingFileChangeRef.current = latestChange._id;

    async function applyChanges() {
      const useSpriteRuntime =
        runtime === "flyio-sprite" &&
        sprite?.status === "running" &&
        sprite?.cloneStatus === "ready";

      const useDropletRuntime =
        runtime === "digitalocean-droplet" &&
        droplet &&
        (droplet.status === "ready" || droplet.status === "active");

      const useFirecrackerRuntime =
        runtime === "firecracker" &&
        firecrackerVm &&
        (firecrackerVm.status === "ready" || firecrackerVm.status === "active");

      const useDockerRuntime =
        runtime === "docker" &&
        dockerContainer &&
        (dockerContainer.status === "ready" || dockerContainer.status === "active");

      try {
        if (useDockerRuntime && dockerContainer) {
          // Apply via Docker container
          const result = await applyFileChangesToDocker({
            containerId: dockerContainer._id,
            fileChangeId: latestChange!._id,
          });
          if (!result.success) {
            throw new Error(result.error || "Failed to apply changes to Docker container");
          }
        } else if (useFirecrackerRuntime && firecrackerVm) {
          // Apply via Firecracker VM
          const result = await applyFileChangesToFirecracker({
            vmId: firecrackerVm._id,
            fileChangeId: latestChange!._id,
          });
          if (!result.success) {
            throw new Error(result.error || "Failed to apply changes to Firecracker VM");
          }
          // Note: markApplied is called inside applyFileChangesToFirecracker action
        } else if (useSpriteRuntime && sprite) {
          // Apply via Fly.io Sprite container
          const result = await applyFileChangesToSprite({
            spriteId: sprite._id,
            fileChangeId: latestChange!._id,
          });
          if (!result.success) {
            throw new Error(result.error || "Failed to apply changes to Sprite");
          }
          // Note: markApplied is called inside applyFileChangesToSprite action
        } else if (useDropletRuntime && droplet) {
          // Apply via DigitalOcean Droplet container
          const result = await applyFileChangesToDroplet({
            dropletId: droplet._id,
            fileChangeId: latestChange!._id,
          });
          if (!result.success) {
            throw new Error(result.error || "Failed to apply changes to Droplet");
          }
          // Note: markApplied is called inside applyFileChangesToDroplet action
        } else {
          // Apply via WebContainer (default)
          const container = await getWebContainer();
          for (const file of latestChange!.files) {
            await writeFile(container, file.path, file.content);
          }
          await markApplied({ fileChangeId: latestChange!._id });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error("Failed to apply file changes:", err);
        toast({
          type: "error",
          message: `Failed to apply changes to the preview: ${errorMsg}`,
        });
        await markFailed({
          fileChangeId: latestChange!._id,
          error: errorMsg,
        }).catch(() => {});
        applyingFileChangeRef.current = null;
      }
    }

    applyChanges();
  }, [latestChange, markApplied, markFailed, toast, runtime, sprite, droplet, firecrackerVm, dockerContainer, applyFileChangesToSprite, applyFileChangesToDroplet, applyFileChangesToFirecracker, applyFileChangesToDocker]);

  // Execute bash commands in WebContainer when they arrive
  // Server-side runtimes (Docker, Sprite, Droplet, Firecracker) handle bash
  // execution within the generateResponse agent loop — no client-side needed.
  useEffect(() => {
    if (!pendingCommand || !sessionId) return;

    const isServerRuntime =
      runtime === "docker" ||
      runtime === "firecracker" ||
      runtime === "flyio-sprite" ||
      runtime === "digitalocean-droplet";

    if (isServerRuntime) return;

    async function executeCommand() {
      const cmd = pendingCommand!;
      try {
        await markCommandRunning({ bashCommandId: cmd._id });
        const container = await getWebContainer();
        const result = await runCommand(container, cmd.command);
        await markCommandCompleted({
          bashCommandId: cmd._id,
          output: result.output,
          exitCode: result.exitCode,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error("Failed to execute bash command:", err);
        await markCommandFailed({
          bashCommandId: cmd._id,
          error: errorMsg,
        }).catch(() => {});
      }
    }

    executeCommand();
  }, [pendingCommand, sessionId, markCommandRunning, markCommandCompleted, markCommandFailed, runtime]);

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

  const addImages = (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const newImages = imageFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...newImages]);
  };

  const removeImage = (index: number) => {
    setPendingImages((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadImages = async (
    images: { file: File; previewUrl: string }[],
  ): Promise<Id<"_storage">[]> => {
    const ids = await Promise.all(
      images.map(async ({ file }) => {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const { storageId } = await result.json();
        return storageId as Id<"_storage">;
      }),
    );
    return ids;
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if ((!trimmed && pendingImages.length === 0) || sending) return;

    setSending(true);
    setInput("");
    const imagesToUpload = [...pendingImages];
    setPendingImages([]);
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

      let imageIds: Id<"_storage">[] | undefined;
      if (imagesToUpload.length > 0) {
        imageIds = await uploadImages(imagesToUpload);
        imagesToUpload.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      }

      await sendMessage({
        sessionId: currentSessionId,
        role: "user",
        content: trimmed || "(image attached)",
        ...(imageIds && imageIds.length > 0 ? { imageIds } : {}),
      });
      if (runtime === "docker") {
        await generateResponseViaCli({ sessionId: currentSessionId });
      } else {
        await generateResponse({ sessionId: currentSessionId });
      }
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to get AI response",
      });
    } finally {
      setSending(false);
    }
  };

  const handleStop = async () => {
    if (!sessionId || !sending) return;
    try {
      await requestStop({ sessionId });
    } catch {
      // ignore errors - the generation may have already completed
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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addImages(imageFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    addImages(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const canSend = (input.trim().length > 0 || pendingImages.length > 0) && !sending;

  const prUrl = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.changes?.prUrl) return m.changes.prUrl;
    }
    return null;
  }, [messages]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-paper-200">
      <SessionPicker
        sessions={sessions}
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />
      {prUrl && (
        <div className="flex items-center gap-2 border-b border-paper-800 px-3 py-1.5 dark:border-paper-400">
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-500 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
            </svg>
            View Pull Request
          </a>
        </div>
      )}
      <MessageList
        messages={messages ?? []}
        repoId={repoId}
        fileChangesByMessageId={fileChangesByMessageId}
        sessionBranch={sessions.find((s) => s._id === sessionId)?.branchName}
        onRetryFileChange={retryApplyChanges}
        isGenerating={sending}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-t border-zinc-200 p-3 dark:border-paper-400"
      >
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="group relative">
                <img
                  src={img.previewUrl}
                  alt={`Attachment ${i + 1}`}
                  className="h-16 w-16 rounded-md border border-zinc-300 object-cover dark:border-zinc-600"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                addImages(Array.from(e.target.files));
                e.target.value = "";
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="flex-shrink-0 rounded-lg p-2 text-paper-600 transition-colors hover:bg-zinc-100 hover:text-paper-800 disabled:opacity-50 dark:text-paper-500 dark:hover:bg-paper-400 dark:hover:text-paper-800"
            title="Attach image"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909L8.56 8a.75.75 0 0 0-1.06 0L2.5 11.06Zm12.5-3.31a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" clipRule="evenodd" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Describe what you'd like to change..."
            disabled={sending}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-paper-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-paper-300 dark:text-paper-950 dark:placeholder:text-paper-500 dark:focus:border-zinc-400"
          />
          {sending ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
              title="Stop generation"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm5-2.25A.75.75 0 0 1 7.75 7h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="rounded-lg bg-paper-200 px-3 py-2 text-sm font-medium text-paper-950 transition-colors hover:bg-paper-400 disabled:opacity-50 dark:bg-paper-700 dark:text-paper-50 dark:hover:bg-zinc-300"
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
          )}
        </div>
      </form>
    </div>
  );
}
