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

type SessionStatus = "empty" | "has_changes" | "pushed" | "pr_open";

type SessionWithStatus = Doc<"sessions"> & { status: SessionStatus };

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === "empty") {
    return null;
  }

  if (status === "has_changes") {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400"
        title="Unpushed changes"
      />
    );
  }

  if (status === "pushed") {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-green-500"
        title="Changes pushed"
      />
    );
  }

  if (status === "pr_open") {
    return (
      <span
        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-purple-500"
        title="Pull request open"
      />
    );
  }

  return null;
}

export function SessionPicker({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
}: {
  sessions: SessionWithStatus[];
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
        className="flex w-full items-center gap-2 border-b border-paper-800 px-3 py-2 text-left text-xs text-paper-500 transition-colors hover:bg-paper-950 dark:border-paper-400 dark:text-paper-600 dark:hover:bg-paper-300"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5 shrink-0"
        >
          <path
            fillRule="evenodd"
            d="M1 8.74c0 .983.713 1.825 1.69 1.943.904.108 1.817.19 2.737.243.363.02.688.231.85.556l1.052 2.103a.75.75 0 0 0 1.342 0l1.052-2.103c.162-.325.487-.535.85-.556.92-.053 1.833-.134 2.738-.243.976-.118 1.689-.96 1.689-1.942V4.259c0-.982-.713-1.824-1.69-1.942a44.45 44.45 0 0 0-10.62 0C1.712 2.435 1 3.277 1 4.26v4.482Z"
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
        <div className="absolute left-0 right-0 top-full z-50 max-h-64 overflow-y-auto border-b border-paper-800 bg-white shadow-lg dark:border-paper-400 dark:bg-paper-200">
          <button
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-paper-50 transition-colors hover:bg-paper-700 dark:text-paper-950 dark:hover:bg-paper-300"
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
            <div className="border-t border-paper-900 dark:border-paper-300">
              {sessions.map((session) => (
                <div
                  key={session._id}
                  className={`group flex w-full items-center gap-1 px-3 py-2 transition-colors hover:bg-paper-700 dark:hover:bg-paper-300 ${
                    session._id === activeSessionId
                      ? "bg-paper-700 dark:bg-paper-300"
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
                      className="flex-1 rounded border border-paper-700 bg-white px-1.5 py-0.5 text-xs text-zinc-700 outline-none focus:border-paper-500 dark:border-paper-400 dark:bg-paper-300 dark:text-paper-700"
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
                        <span className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-700 dark:text-paper-700">
                          <StatusBadge status={session.status} />
                          <span className="truncate">
                            {session.featureName ?? getSessionLabel(session)}
                          </span>
                        </span>
                        <span className="ml-2 shrink-0 text-[10px] text-paper-600">
                          {formatRelativeTime(session.lastActiveAt)}
                        </span>
                      </div>
                      {session.branchName && (
                        <span className="truncate text-[11px] font-mono text-blue-400 dark:text-blue-400">
                          {session.branchName}
                        </span>
                      )}
                      {session.firstMessage && session.name && (
                        <span className="truncate text-[11px] text-paper-600 dark:text-paper-500">
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
                      handleStartRename(session);
                    }}
                    className="shrink-0 rounded p-0.5 text-paper-600 opacity-0 transition-opacity hover:text-paper-800 group-hover:opacity-100 dark:text-paper-500 dark:hover:text-paper-700"
                    title="Rename session"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.262a1.75 1.75 0 0 0 0-2.474Z"
                      />
                      <path
                        d="M4.75 3.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9A.75.75 0 0 1 14 9v2.25A2.75 2.75 0 0 1 11.25 14h-6.5A2.75 2.75 0 0 1 2 11.25v-6.5A2.75 2.75 0 0 1 4.75 2H7a.75.75 0 0 1 0 1.5H4.75Z"
                      />
                    </svg>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSessionId(session._id);
                    }}
                    className="shrink-0 rounded p-0.5 text-paper-600 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-paper-500 dark:hover:text-red-400"
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
