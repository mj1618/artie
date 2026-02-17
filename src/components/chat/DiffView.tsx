"use client";

import { structuredPatch } from "diff";

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  filePath: string;
}

export function DiffView({ oldContent, newContent, filePath }: DiffViewProps) {
  const patch = structuredPatch(filePath, filePath, oldContent, newContent);

  if (patch.hunks.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-paper-500">
        No changes
      </div>
    );
  }

  return (
    <pre className="text-xs leading-relaxed">
      {patch.hunks.map((hunk, hunkIndex) => {
        let newLineNum = hunk.newStart;
        return (
        <div key={hunkIndex}>
          <div className="bg-paper-800/50 px-2 py-0.5 font-mono text-paper-500 dark:bg-paper-400/50 dark:text-paper-600">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
            {hunk.newLines} @@
          </div>
          {hunk.lines.map((line, lineIndex) => {
            const prefix = line[0];
            const currentLineNum = prefix !== "-" ? newLineNum++ : null;

            if (prefix === "+") {
              return (
                <div
                  key={`${hunkIndex}-${lineIndex}`}
                  className="bg-green-950/30 text-green-300"
                >
                  <span className="inline-block w-8 select-none pr-2 text-right text-green-600/60">
                    {currentLineNum}
                  </span>
                  {line}
                </div>
              );
            }
            if (prefix === "-") {
              return (
                <div
                  key={`${hunkIndex}-${lineIndex}`}
                  className="bg-red-950/30 text-red-300"
                >
                  <span className="inline-block w-8 select-none pr-2 text-right text-red-600/60">
                    &nbsp;
                  </span>
                  {line}
                </div>
              );
            }
            return (
              <div
                key={`${hunkIndex}-${lineIndex}`}
                className="text-zinc-700 dark:text-paper-700"
              >
                <span className="inline-block w-8 select-none pr-2 text-right text-paper-500/60">
                  {currentLineNum}
                </span>
                {line}
              </div>
            );
          })}
        </div>
        );
      })}
    </pre>
  );
}
