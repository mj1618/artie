"use client";

import { useState, useRef, useEffect } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import {
  useWorkspaceContainer,
  type ContainerPhase,
} from "@/lib/webcontainer/useWorkspaceContainer";
import { FileExplorer } from "./FileExplorer";
import { PreviewNavBar } from "./PreviewNavBar";
import { useToast } from "@/lib/useToast";

interface PreviewPanelProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
}

function PhaseLabel({ phase }: { phase: ContainerPhase }) {
  switch (phase) {
    case "idle":
      return <span>Initializing...</span>;
    case "booting":
      return <span>Starting WebContainer...</span>;
    case "fetching":
      return <span>Loading repository files...</span>;
    case "mounting":
      return <span>Mounting files...</span>;
    case "installing":
      return <span>Installing dependencies...</span>;
    case "starting":
      return <span>Starting dev server...</span>;
    case "running":
      return <span>Running</span>;
    case "error":
      return <span>Error</span>;
  }
}

function TerminalOutput({ output }: { output: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output.length]);

  return (
    <div className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
      {output.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export function PreviewPanel({ repoId, sessionId }: PreviewPanelProps) {
  const [view, setView] = useState<"preview" | "code" | "terminal">("preview");
  const { phase, previewUrl, error, output, retry, refreshFiles, refreshing } =
    useWorkspaceContainer(repoId, sessionId);
  const { toast } = useToast();

  const handleRefreshFromGitHub = async () => {
    const result = await refreshFiles();
    if (result.success) {
      if (result.skippedCount > 0) {
        toast({
          type: "info",
          message: `Pulled latest from GitHub. Your uncommitted changes to ${result.skippedCount} file${result.skippedCount === 1 ? "" : "s"} were preserved.`,
        });
      } else {
        toast({ type: "success", message: "Pulled latest files from GitHub." });
      }
    } else {
      toast({
        type: "error",
        message: result.error ?? "Failed to refresh files from GitHub.",
      });
    }
  };

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  // Sync currentUrl when previewUrl first becomes available
  const [lastPreviewUrl, setLastPreviewUrl] = useState<string | null>(null);
  if (previewUrl && previewUrl !== lastPreviewUrl) {
    setLastPreviewUrl(previewUrl);
    if (!currentUrl) {
      setCurrentUrl(previewUrl);
    }
  }

  const isLoading =
    phase !== "running" && phase !== "error";
  const isRunning = phase === "running";
  const isError = phase === "error";

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    }`;

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-zinc-950">
      {/* Toggle bar */}
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <button
          onClick={() => setView("preview")}
          className={tabClass(view === "preview")}
        >
          Preview
        </button>
        <button
          onClick={() => setView("code")}
          className={tabClass(view === "code")}
        >
          Code
        </button>
        <button
          onClick={() => setView("terminal")}
          className={tabClass(view === "terminal")}
        >
          Terminal
        </button>
      </div>

      {/* Content area */}
      {view === "terminal" ? (
        <TerminalOutput output={output} />
      ) : view === "code" ? (
        <FileExplorer containerReady={phase !== "idle" && phase !== "booting"} />
      ) : isRunning && previewUrl && currentUrl ? (
        <>
          <PreviewNavBar
            previewUrl={currentUrl}
            iframeRef={iframeRef}
            onNavigate={setCurrentUrl}
            onRefreshFromGitHub={handleRefreshFromGitHub}
            refreshing={refreshing}
          />
          <iframe
            ref={iframeRef}
            src={currentUrl}
            allow="cross-origin-isolated"
            title="Live Preview"
            className="flex-1 w-full bg-white"
            style={{ border: "none" }}
          />
        </>
      ) : isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-6 w-6 text-red-500"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <p className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
          {output.length > 0 && (
            <div className="w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-40 overflow-auto">
              {output.slice(-10).map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={retry}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-600 dark:border-t-white" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <PhaseLabel phase={phase} />
          </p>
          {output.length > 0 && (
            <div className="w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-32 overflow-auto">
              {output.slice(-5).map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-6 w-6 text-zinc-400"
              >
                <path
                  fillRule="evenodd"
                  d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.217-.818a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06l-1.72-1.72v6.228a.75.75 0 0 1-1.5 0V7.522l-1.72 1.72a.75.75 0 0 1-1.06-1.06l3.5-3.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Send a message to see a live preview
            </p>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <p
          className={`text-xs ${
            isRunning
              ? "text-emerald-600 dark:text-emerald-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : isLoading
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {isRunning && previewUrl
            ? `Running on ${previewUrl}`
            : isError
              ? "Error — see details above"
              : isLoading
                ? <PhaseLabel phase={phase} />
                : "No preview available"}
        </p>
      </div>
    </div>
  );
}
