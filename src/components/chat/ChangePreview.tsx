"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { getWebContainer } from "@/lib/webcontainer/index";
import { writeFile } from "@/lib/webcontainer/files";
import { useToast } from "@/lib/useToast";
import { DiffView } from "./DiffView";

interface FileChange {
  path: string;
  content: string;
  originalContent?: string;
}

interface ChangePreviewProps {
  files: FileChange[];
  fileChangeId: Id<"fileChanges">;
  reverted?: boolean;
  committed?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function ChangePreview({
  files,
  fileChangeId,
  reverted,
  committed,
  error,
  onRetry,
}: ChangePreviewProps) {
  const [expanded, setExpanded] = useState(true);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<Record<string, "diff" | "full">>({});
  const [reverting, setReverting] = useState(false);
  const revertFileChange = useMutation(api.fileChanges.revertFileChange);
  const { toast } = useToast();

  const handleRevert = async () => {
    setReverting(true);
    try {
      const container = await getWebContainer();
      for (const file of files) {
        if (file.originalContent !== undefined) {
          await writeFile(container, file.path, file.originalContent);
        }
      }
      await revertFileChange({ fileChangeId });
      toast({ type: "success", message: "Changes reverted" });
    } catch (err) {
      console.error("Failed to revert changes:", err);
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to revert changes",
      });
    } finally {
      setReverting(false);
    }
  };

  const canRevert = !reverted && !committed;
  const hasOriginals = files.some((f) => f.originalContent !== undefined);

  return (
    <div className="mt-2 rounded border border-paper-800 dark:border-paper-400">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-paper-400 hover:bg-paper-950 dark:text-paper-600 dark:hover:bg-paper-300"
      >
        <span>
          {files.length} file{files.length !== 1 ? "s" : ""} changed
          {reverted && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Reverted
            </span>
          )}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {error && !reverted && (
        <div className="flex items-center gap-2 border-t border-paper-800 px-3 py-2 dark:border-paper-400">
          <div className="flex flex-1 items-center gap-2 text-sm text-amber-400">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <span className="text-xs">Failed to apply to preview</span>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-paper-800 dark:border-paper-400">
          {files.map((file) => {
            const isCollapsed = collapsedFiles.has(file.path);
            const isNew = file.originalContent === undefined;
            return (
              <div
                key={file.path}
                className="border-b border-paper-900 last:border-b-0 dark:border-paper-300"
              >
                <button
                  onClick={() =>
                    setCollapsedFiles((prev) => {
                      const next = new Set(prev);
                      if (next.has(file.path)) next.delete(file.path);
                      else next.add(file.path);
                      return next;
                    })
                  }
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-paper-950 dark:hover:bg-paper-300"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-zinc-700 dark:text-paper-700">
                      {file.path}
                    </span>
                    {isNew && (
                      <span className="rounded bg-green-800/40 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                        new
                      </span>
                    )}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-3 w-3 text-paper-600 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div>
                    {!isNew && (
                      <div className="flex gap-1 border-b border-paper-800 px-3 py-1 dark:border-paper-400">
                        <button
                          onClick={() =>
                            setViewMode((prev) => ({
                              ...prev,
                              [file.path]: "diff",
                            }))
                          }
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            (viewMode[file.path] ?? "diff") === "diff"
                              ? "bg-paper-800 text-paper-200 dark:bg-paper-400 dark:text-paper-800"
                              : "text-paper-500 hover:text-paper-300 dark:text-paper-600 dark:hover:text-paper-800"
                          }`}
                        >
                          Diff
                        </button>
                        <button
                          onClick={() =>
                            setViewMode((prev) => ({
                              ...prev,
                              [file.path]: "full",
                            }))
                          }
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            (viewMode[file.path] ?? "diff") === "full"
                              ? "bg-paper-800 text-paper-200 dark:bg-paper-400 dark:text-paper-800"
                              : "text-paper-500 hover:text-paper-300 dark:text-paper-600 dark:hover:text-paper-800"
                          }`}
                        >
                          Full
                        </button>
                      </div>
                    )}
                    <div className="max-h-80 overflow-auto bg-paper-950 dark:bg-paper-200">
                      {(viewMode[file.path] ?? "diff") === "diff" ? (
                        <DiffView
                          oldContent={file.originalContent ?? ""}
                          newContent={file.content}
                          filePath={file.path}
                        />
                      ) : (
                        <pre className="px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:text-paper-700">
                          <code>{file.content}</code>
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {canRevert && hasOriginals && (
            <div className="border-t border-paper-800 px-3 py-2 dark:border-paper-400">
              <button
                onClick={handleRevert}
                disabled={reverting}
                className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
              >
                {reverting ? "Reverting..." : "Revert Changes"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
