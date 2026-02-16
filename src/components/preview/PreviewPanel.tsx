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
import { SandpackPreview } from "./SandpackPreview";
import { FlyioSpritePreview } from "./FlyioSpritePreview";

type RuntimeType = "webcontainer" | "flyio-sprite" | "sandpack";

interface PreviewPanelProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
  runtime?: RuntimeType;
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

function BootProgressStepper({ phase }: { phase: ContainerPhase }) {
  const steps = [
    { key: "booting", label: "Starting environment" },
    { key: "fetching", label: "Loading files" },
    { key: "installing", label: "Installing dependencies" },
    { key: "starting", label: "Starting dev server" },
    { key: "running", label: "Ready" },
  ];

  const phaseToStep: Record<string, number> = {
    idle: -1,
    booting: 0,
    fetching: 1,
    mounting: 1,
    installing: 2,
    starting: 3,
    running: 4,
  };

  const currentStep = phaseToStep[phase] ?? -1;

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, i) => {
        const isComplete = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <div key={step.key} className="flex items-center gap-3">
            {isComplete ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
                <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            ) : isCurrent ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-blue-400 animate-pulse">
                <div className="h-2 w-2 rounded-full bg-blue-400" />
              </div>
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-700">
                <div className="h-2 w-2 rounded-full bg-zinc-700" />
              </div>
            )}

            <span className={`text-sm ${
              isComplete ? "text-emerald-400" : isCurrent ? "text-zinc-100" : "text-zinc-600"
            }`}>
              {step.label}
              {isCurrent && "..."}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface FriendlyError {
  title: string;
  description: string;
  suggestion: string;
}

function getFriendlyError(rawError: string): FriendlyError {
  const lower = rawError.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network error") || lower.includes("etch failed")) {
    return {
      title: "Connection issue",
      description: "We couldn't download the repository files.",
      suggestion: "Check your internet connection and try again.",
    };
  }

  if (lower.includes("webcontainer") || lower.includes("boot") || lower.includes("sharedarraybuffer")) {
    return {
      title: "Browser environment issue",
      description: "The preview environment couldn't start in your browser.",
      suggestion: "Try refreshing the page, or use a different browser (Chrome or Edge recommended).",
    };
  }

  if (lower.includes("npm install") || lower.includes("npm err") || lower.includes("enoent") || lower.includes("package.json")) {
    return {
      title: "Dependency installation failed",
      description: "Some project dependencies couldn't be installed.",
      suggestion: "This usually resolves on retry. Click Retry below.",
    };
  }

  if (lower.includes("exited with code") || lower.includes("process exited") || lower.includes("eaddrinuse")) {
    return {
      title: "Dev server stopped unexpectedly",
      description: "The development server encountered an issue and stopped.",
      suggestion: "Click Retry to restart the preview.",
    };
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      title: "Preview took too long",
      description: "The preview didn't start within the expected time.",
      suggestion: "Large projects may take longer. Click Retry to try again.",
    };
  }

  if (lower.includes("memory") || lower.includes("heap") || lower.includes("oom") || lower.includes("allocation")) {
    return {
      title: "Out of memory",
      description: "The preview ran out of browser memory.",
      suggestion: "Close other browser tabs and try again. Very large projects may need the Fly.io runtime instead.",
    };
  }

  return {
    title: "Something went wrong",
    description: "The preview couldn't start.",
    suggestion: "Click Retry below. If the problem persists, check the terminal output for details.",
  };
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

export function PreviewPanel({ repoId, sessionId, branch, runtime = "webcontainer" }: PreviewPanelProps) {
  // If Sandpack runtime, render SandpackPreview component
  if (runtime === "sandpack") {
    return <SandpackPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
  }

  // If Fly.io Sprite runtime, render FlyioSpritePreview component
  if (runtime === "flyio-sprite") {
    return <FlyioSpritePreview repoId={repoId} sessionId={sessionId} branch={branch} />;
  }

  // WebContainer runtime (default)
  return <WebContainerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
}

function WebContainerPreview({ repoId, sessionId, branch }: Omit<PreviewPanelProps, "runtime">) {
  const [view, setView] = useState<"preview" | "code" | "terminal">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const { phase, previewUrl, error, output, retry, refreshFiles, refreshing } =
    useWorkspaceContainer(repoId, sessionId, { branch });
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
          {(() => {
            const friendly = getFriendlyError(error ?? "");
            return (
              <>
                <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">{friendly.title}</h3>
                <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
                  {friendly.description}
                </p>
                <p className="max-w-sm text-center text-xs text-zinc-500 dark:text-zinc-500">
                  {friendly.suggestion}
                </p>
              </>
            );
          })()}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-400 underline"
          >
            {showDetails ? "Hide technical details" : "Show technical details"}
          </button>
          {showDetails && error && (
            <p className="max-w-sm text-center font-mono text-xs text-red-500/70 dark:text-red-400/70">
              {error}
            </p>
          )}
          {showDetails && output.length > 0 && (
            <div className="w-full max-w-lg rounded bg-zinc-100 p-3 font-mono text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 max-h-40 overflow-auto">
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
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <BootProgressStepper phase={phase} />
          {output.length > 0 && (
            <div className="mt-2 w-full max-w-lg rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-400 max-h-32 overflow-auto">
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
