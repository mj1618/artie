"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { structuredPatch } from "diff";

interface ReviewTabProps {
  sessionId: Id<"sessions"> | null;
}

interface FileDiffStats {
  additions: number;
  deletions: number;
}

function computeStats(oldContent: string, newContent: string): FileDiffStats {
  const patch = structuredPatch("", "", oldContent, newContent);
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line[0] === "+") additions++;
      else if (line[0] === "-") deletions++;
    }
  }
  return { additions, deletions };
}

function StatBar({ additions, deletions }: FileDiffStats) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;
  return (
    <span className="ml-2 inline-flex gap-px">
      {Array.from({ length: addBlocks }).map((_, i) => (
        <span key={`a${i}`} className="inline-block h-2 w-2 rounded-sm bg-green-500" />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <span key={`d${i}`} className="inline-block h-2 w-2 rounded-sm bg-red-500" />
      ))}
    </span>
  );
}

function FileDiff({
  path,
  originalContent,
  currentContent,
  isNew,
}: {
  path: string;
  originalContent: string;
  currentContent: string;
  isNew: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const patch = structuredPatch(path, path, originalContent, currentContent);
  const stats = computeStats(originalContent, currentContent);

  return (
    <div className="border border-paper-300 rounded-md overflow-hidden dark:border-paper-600">
      {/* File header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 bg-paper-200 px-3 py-2 text-left text-xs hover:bg-paper-250 dark:bg-paper-700 dark:hover:bg-paper-650"
      >
        <svg
          className={`h-3 w-3 text-paper-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>

        <span className="font-mono text-paper-800 dark:text-paper-400">{path}</span>

        {isNew && (
          <span className="rounded bg-green-700 px-1.5 py-0.5 text-[10px] font-medium text-white">
            new
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 text-paper-500">
          {stats.additions > 0 && (
            <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
          )}
          {stats.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
          )}
          <StatBar additions={stats.additions} deletions={stats.deletions} />
        </span>
      </button>

      {/* Diff content */}
      {expanded && (
        <div className="overflow-auto bg-paper-100 dark:bg-paper-800">
          {patch.hunks.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-paper-500">
              No changes
            </div>
          ) : (
            <pre className="text-xs leading-relaxed">
              {patch.hunks.map((hunk, hi) => {
                let oldLineNum = hunk.oldStart;
                let newLineNum = hunk.newStart;
                return (
                  <div key={hi}>
                    {!isNew && (
                      <div className="bg-blue-950/20 px-2 py-0.5 text-blue-400 dark:bg-blue-900/20 dark:text-blue-300">
                        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                      </div>
                    )}
                    {hunk.lines.map((line, li) => {
                      const prefix = line[0];
                      const oldNum = prefix !== "+" ? oldLineNum++ : null;
                      const newNum = prefix !== "-" ? newLineNum++ : null;

                      if (prefix === "+") {
                        return (
                          <div key={`${hi}-${li}`} className="flex bg-green-950/20 dark:bg-green-950/30">
                            <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-paper-500/40 dark:border-paper-600">&nbsp;</span>
                            <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-green-600/60 dark:border-paper-600">{newNum}</span>
                            <span className="w-5 shrink-0 select-none text-center text-green-500">+</span>
                            <span className="text-green-300 dark:text-green-300">{line.slice(1)}</span>
                          </div>
                        );
                      }
                      if (prefix === "-") {
                        return (
                          <div key={`${hi}-${li}`} className="flex bg-red-950/20 dark:bg-red-950/30">
                            <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-red-600/60 dark:border-paper-600">{oldNum}</span>
                            <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-paper-500/40 dark:border-paper-600">&nbsp;</span>
                            <span className="w-5 shrink-0 select-none text-center text-red-500">-</span>
                            <span className="text-red-300 dark:text-red-300">{line.slice(1)}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={`${hi}-${li}`} className="flex">
                          <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-paper-500/40 dark:border-paper-600">{oldNum}</span>
                          <span className="w-10 shrink-0 select-none border-r border-paper-300 pr-1 text-right text-paper-500/40 dark:border-paper-600">{newNum}</span>
                          <span className="w-5 shrink-0 select-none text-center text-paper-400">&nbsp;</span>
                          <span className="text-paper-700 dark:text-paper-500">{line.slice(1)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewTab({ sessionId }: ReviewTabProps) {
  const diffData = useQuery(
    api.fileChanges.getSessionDiff,
    sessionId ? { sessionId } : "skip",
  );

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-paper-500">
        Select a session to see changes
      </div>
    );
  }

  if (diffData === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-paper-400 border-t-paper-700" />
      </div>
    );
  }

  if (diffData.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-paper-500">
        No file changes yet. Send a message to get started.
      </div>
    );
  }

  const totalStats = diffData.reduce(
    (acc, file) => {
      const s = computeStats(file.originalContent, file.currentContent);
      return { additions: acc.additions + s.additions, deletions: acc.deletions + s.deletions };
    },
    { additions: 0, deletions: 0 },
  );

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-paper-100 p-3 dark:bg-paper-800">
      {/* Summary header */}
      <div className="mb-3 flex items-center gap-3 text-xs text-paper-600 dark:text-paper-500">
        <span>
          Showing{" "}
          <strong className="text-paper-800 dark:text-paper-300">{diffData.length}</strong>{" "}
          changed file{diffData.length !== 1 ? "s" : ""}
        </span>
        <span className="text-green-600 dark:text-green-400">+{totalStats.additions}</span>
        <span className="text-red-600 dark:text-red-400">-{totalStats.deletions}</span>
      </div>

      {/* File diffs */}
      <div className="space-y-3">
        {diffData.map((file) => (
          <FileDiff
            key={file.path}
            path={file.path}
            originalContent={file.originalContent}
            currentContent={file.currentContent}
            isNew={file.isNew}
          />
        ))}
      </div>
    </div>
  );
}
