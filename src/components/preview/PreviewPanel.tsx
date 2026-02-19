"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import {
  useWorkspaceContainer,
  type ContainerPhase,
} from "@/lib/webcontainer/useWorkspaceContainer";
import { FileExplorer } from "./FileExplorer";
import { PreviewNavBar } from "./PreviewNavBar";
import { useToast } from "@/lib/useToast";
import { SandpackPreview } from "./SandpackPreview";
import { FlyioSpritePreview } from "./FlyioSpritePreview";
import { DropletPreview } from "./DropletPreview";
import { FirecrackerPreview } from "./FirecrackerPreview";
import { DockerPreview } from "./DockerPreview";
import { ReviewTab } from "./ReviewTab";

type RuntimeType = "webcontainer" | "flyio-sprite" | "sandpack" | "digitalocean-droplet" | "firecracker" | "docker";

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
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-paper-400">
                <div className="h-2 w-2 rounded-full bg-paper-400" />
              </div>
            )}

            <span className={`text-sm ${
              isComplete ? "text-emerald-400" : isCurrent ? "text-paper-900" : "text-paper-400"
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

function TerminalOutput({
  output,
  bashCommands,
}: {
  output: string[];
  bashCommands?: Doc<"bashCommands">[];
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output.length, bashCommands?.length]);

  return (
    <div className="flex-1 overflow-auto bg-paper-100 p-3 font-mono text-xs leading-relaxed text-paper-700">
      {/* Boot/dev server output */}
      {output.map((line, i) => (
        <div key={`boot-${i}`} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}

      {/* Bash command output */}
      {bashCommands && bashCommands.length > 0 && (
        <>
          {output.length > 0 && (
            <div className="my-3 border-t border-paper-300" />
          )}
          {bashCommands.map((cmd) => (
            <div key={cmd._id} className="mb-3">
              <div className="flex items-center gap-2 text-paper-500">
                <span className="text-emerald-600">$</span>
                <span className="text-paper-800">{cmd.command}</span>
                {cmd.status === "running" && (
                  <span className="animate-pulse text-yellow-600">
                    (running...)
                  </span>
                )}
                {cmd.status === "pending" && (
                  <span className="text-paper-400">(pending)</span>
                )}
              </div>
              {cmd.output && (
                <div className="mt-1 whitespace-pre-wrap break-all pl-4 text-paper-600">
                  {cmd.output}
                </div>
              )}
              {cmd.error && (
                <div className="mt-1 pl-4 text-red-500">{cmd.error}</div>
              )}
              {cmd.status === "completed" && cmd.exitCode !== undefined && (
                <div
                  className={`mt-1 pl-4 text-xs ${
                    cmd.exitCode === 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  exit code: {cmd.exitCode}
                </div>
              )}
              {cmd.status === "failed" && (
                <div className="mt-1 pl-4 text-xs text-red-500">
                  exit code: {cmd.exitCode ?? "N/A"}
                </div>
              )}
            </div>
          ))}
        </>
      )}
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

  // If DigitalOcean Droplet runtime, render DropletPreview component
  if (runtime === "digitalocean-droplet") {
    return <DropletPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
  }

  // If Firecracker runtime, render FirecrackerPreview component
  if (runtime === "firecracker") {
    return <FirecrackerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
  }

  // If Docker runtime, render DockerPreview component
  if (runtime === "docker") {
    return <DockerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
  }

  // WebContainer runtime (default)
  return <WebContainerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
}

function WebContainerPreview({ repoId, sessionId, branch }: Omit<PreviewPanelProps, "runtime">) {
  const [view, setView] = useState<"preview" | "code" | "terminal" | "review">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const { phase, previewUrl, error, output, retry, refreshFiles, refreshing } =
    useWorkspaceContainer(repoId, sessionId, { branch });
  const { toast } = useToast();

  // Query bash commands for this session
  const bashCommands = useQuery(
    api.bashCommands.listBySession,
    sessionId ? { sessionId } : "skip",
  );

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
        ? "bg-paper-200 text-paper-950 dark:bg-paper-700 dark:text-paper-200"
        : "text-paper-500 hover:text-paper-400 dark:text-paper-600 dark:hover:text-paper-800"
    }`;

  return (
    <div className="flex h-full flex-col bg-paper-700 dark:bg-paper-100">
      {/* Toggle bar */}
      <div className="flex items-center gap-1 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
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
        <button
          onClick={() => setView("review")}
          className={tabClass(view === "review")}
        >
          Review
        </button>
      </div>

      {/* Content area */}
      {view === "review" ? (
        <ReviewTab sessionId={sessionId} />
      ) : view === "terminal" ? (
        <TerminalOutput output={output} bashCommands={bashCommands} />
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
                <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">{friendly.title}</h3>
                <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
                  {friendly.description}
                </p>
                <p className="max-w-sm text-center text-xs text-paper-500 dark:text-paper-500">
                  {friendly.suggestion}
                </p>
              </>
            );
          })()}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-paper-500 hover:text-paper-400 dark:text-paper-400 dark:hover:text-paper-600 underline"
          >
            {showDetails ? "Hide technical details" : "Show technical details"}
          </button>
          {showDetails && error && (
            <p className="max-w-sm text-center font-mono text-xs text-red-500/70 dark:text-red-400/70">
              {error}
            </p>
          )}
          {showDetails && output.length > 0 && (
            <div className="w-full max-w-lg rounded bg-paper-700 p-3 font-mono text-xs text-paper-400 dark:bg-paper-100 dark:text-paper-600 max-h-40 overflow-auto">
              {output.slice(-10).map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={retry}
            className="rounded bg-paper-200 px-4 py-2 text-sm font-medium text-paper-950 hover:bg-paper-300 dark:bg-paper-700 dark:text-paper-200 dark:hover:bg-paper-600"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <BootProgressStepper phase={phase} />
          {output.length > 0 && (
            <div className="mt-2 w-full max-w-lg rounded bg-paper-100 p-3 font-mono text-xs text-paper-600 max-h-32 overflow-auto">
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
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-paper-600 dark:bg-paper-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-6 w-6 text-paper-600"
              >
                <path
                  fillRule="evenodd"
                  d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.217-.818a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1-1.06 1.06l-1.72-1.72v6.228a.75.75 0 0 1-1.5 0V7.522l-1.72 1.72a.75.75 0 0 1-1.06-1.06l3.5-3.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-sm text-paper-500 dark:text-paper-600">
              Send a message to see a live preview
            </p>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="border-t border-paper-600 px-4 py-2 dark:border-paper-300">
        <p
          className={`text-xs ${
            isRunning
              ? "text-emerald-600 dark:text-emerald-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : isLoading
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-paper-600 dark:text-paper-500"
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
