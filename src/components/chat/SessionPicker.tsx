"use client";

import { useState, useRef, useEffect } from "react";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return (
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ` at ${time}`
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSessionLabel(session: Doc<"sessions">): string {
  if (session.name) return session.name;
  if (session.firstMessage) {
    return session.firstMessage.length > 40
      ? session.firstMessage.slice(0, 40) + "..."
      : session.firstMessage;
  }
  return formatSessionDate(session.createdAt);
}

export function SessionPicker({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
}: {
  sessions: Doc<"sessions">[];
  activeSessionId: Id<"sessions"> | null;
  onSelectSession: (sessionId: Id<"sessions">) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: Id<"sessions">) => void;
  onRenameSession: (sessionId: Id<"sessions">, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [editingSessionId, setEditingSessionId] = useState<Id<"sessions"> | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteSessionId, setDeleteSessionId] = useState<Id<"sessions"> | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setEditingSessionId(null);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const activeSession = sessions.find((s) => s._id === activeSessionId);
  const label = activeSession ? getSessionLabel(activeSession) : "New chat";

  const handleStartRename = (session: Doc<"sessions">) => {
    setEditingSessionId(session._id);
    setEditName(session.name || "");
  };

  const handleSaveRename = () => {
    if (editingSessionId) {
      onRenameSession(editingSessionId, editName);
      setEditingSessionId(null);
    }
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
    setEditName("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteSessionId) return;
    setDeleteLoading(true);
    try {
      onDeleteSession(deleteSessionId);
    } finally {
      setDeleteLoading(false);
      setDeleteSessionId(null);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-b border-zinc-200 px-3 py-2 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5 shrink-0"
        >
          <path
            fillRule="evenodd"
            d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="truncate font-medium">{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`ml-auto h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-64 overflow-y-auto border-b border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-white dark:hover:bg-zinc-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
            </svg>
            New Chat
          </button>

          {sessions.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800">
              {sessions.map((session) => (
                <div
                  key={session._id}
                  className={`group flex w-full items-center gap-1 px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    session._id === activeSessionId
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : ""
                  }`}
                >
                  {editingSessionId === session._id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRename();
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      onBlur={handleSaveRename}
                      className="flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                      placeholder="Session name..."
                    />
                  ) : (
                    <button
                      onClick={() => {
                        onSelectSession(session._id);
                        setOpen(false);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleStartRename(session);
                      }}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {getSessionLabel(session)}
                        </span>
                        <span className="ml-2 shrink-0 text-[10px] text-zinc-400">
                          {formatRelativeTime(session.lastActiveAt)}
                        </span>
                      </div>
                      {session.firstMessage && session.name && (
                        <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                          {session.firstMessage.length > 50
                            ? session.firstMessage.slice(0, 50) + "..."
                            : session.firstMessage}
                        </span>
                      )}
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSessionId(session._id);
                    }}
                    className="ml-1 shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-zinc-500 dark:hover:text-red-400"
                    title="Delete session"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteSessionId !== null}
        onClose={() => setDeleteSessionId(null)}
        onConfirm={handleConfirmDelete}
        title="Delete session"
        description="This will permanently delete this session and all its messages and file changes. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
      />
    </div>
  );
}
