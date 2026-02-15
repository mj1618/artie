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
}

export function ChangePreview({
  files,
  fileChangeId,
  reverted,
  committed,
}: ChangePreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
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
    <div className="mt-2 rounded border border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
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

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700">
          {files.map((file) => {
            const isFileExpanded = expandedFile === file.path;
            const lineCount = file.content.split("\n").length;
            return (
              <div
                key={file.path}
                className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
              >
                <button
                  onClick={() =>
                    setExpandedFile(isFileExpanded ? null : file.path)
                  }
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    {file.path}
                  </span>
                  <span className="text-zinc-400">
                    {lineCount} line{lineCount !== 1 ? "s" : ""}
                  </span>
                </button>
                {isFileExpanded && (
                  <div>
                    {file.originalContent !== undefined && (
                      <div className="flex gap-1 border-b border-zinc-200 px-3 py-1 dark:border-zinc-700">
                        <button
                          onClick={() =>
                            setViewMode((prev) => ({
                              ...prev,
                              [file.path]: "diff",
                            }))
                          }
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            (viewMode[file.path] ?? "diff") === "diff"
                              ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
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
                              ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                          }`}
                        >
                          Full
                        </button>
                      </div>
                    )}
                    <div className="max-h-64 overflow-auto bg-zinc-50 dark:bg-zinc-900">
                      {file.originalContent !== undefined &&
                      (viewMode[file.path] ?? "diff") === "diff" ? (
                        <DiffView
                          oldContent={file.originalContent}
                          newContent={file.content}
                          filePath={file.path}
                        />
                      ) : (
                        <pre className="px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
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
            <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
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
