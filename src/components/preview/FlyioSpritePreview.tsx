"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

interface FlyioSpritePreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

type SpritePhase = 
  | "idle"
  | "provisioning"
  | "deploying"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

function PhaseLabel({ phase }: { phase: SpritePhase }) {
  switch (phase) {
    case "idle":
      return <span>Waiting to start...</span>;
    case "provisioning":
      return <span>Creating Fly.io app...</span>;
    case "deploying":
      return <span>Deploying container...</span>;
    case "running":
      return <span>Running</span>;
    case "stopping":
      return <span>Stopping...</span>;
    case "stopped":
      return <span>Stopped</span>;
    case "error":
      return <span>Error</span>;
  }
}

function BootProgressStepper({ phase }: { phase: SpritePhase }) {
  const steps = [
    { key: "provisioning", label: "Creating Fly.io app" },
    { key: "deploying", label: "Deploying container" },
    { key: "running", label: "Ready" },
  ];

  const phaseToStep: Record<string, number> = {
    idle: -1,
    provisioning: 0,
    deploying: 1,
    running: 2,
    stopping: 2,
    stopped: -1,
    error: -1,
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20">
                <svg className="h-3.5 w-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            ) : isCurrent ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-purple-400 animate-pulse">
                <div className="h-2 w-2 rounded-full bg-purple-400" />
              </div>
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-700">
                <div className="h-2 w-2 rounded-full bg-zinc-700" />
              </div>
            )}

            <span className={`text-sm ${
              isComplete ? "text-purple-400" : isCurrent ? "text-zinc-100" : "text-zinc-600"
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

function FlyioLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="currentColor">
      <path d="M100 0C44.8 0 0 44.8 0 100s44.8 100 100 100 100-44.8 100-100S155.2 0 100 0zm0 180c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"/>
      <path d="M140 80H60c-5.5 0-10 4.5-10 10v20c0 5.5 4.5 10 10 10h80c5.5 0 10-4.5 10-10V90c0-5.5-4.5-10-10-10z"/>
    </svg>
  );
}

export function FlyioSpritePreview({ repoId, sessionId, branch }: FlyioSpritePreviewProps) {
  const [view, setView] = useState<"preview" | "logs">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  // Query the Sprite for this session
  const sprite = useQuery(
    api.flyioSprites.getBySession,
    sessionId ? { sessionId } : "skip"
  );

  // Mutations and actions
  const provision = useMutation(api.flyioSprites.provision);
  const heartbeat = useMutation(api.flyioSprites.heartbeat);
  const stop = useMutation(api.flyioSprites.stop);
  const provisionFlyioApp = useAction(api.flyioSprites.provisionFlyioApp);
  const destroyFlyioApp = useAction(api.flyioSprites.destroyFlyioApp);

  // Track if we've initiated provisioning
  const [provisioningInitiated, setProvisioningInitiated] = useState(false);

  // Auto-provision Sprite when session is available
  useEffect(() => {
    if (!sessionId || provisioningInitiated) return;

    async function initSprite() {
      try {
        const spriteId = await provision({ sessionId: sessionId!, branch });
        setProvisioningInitiated(true);
        
        // If newly created or restarting, trigger the Fly.io provisioning
        // We check the sprite status after a small delay to get the updated status
        setTimeout(async () => {
          try {
            await provisionFlyioApp({ spriteId });
          } catch (err) {
            console.error("Failed to provision Fly.io app:", err);
          }
        }, 100);
      } catch (err) {
        console.error("Failed to provision sprite:", err);
      }
    }

    initSprite();
  }, [sessionId, branch, provisioningInitiated, provision, provisionFlyioApp]);

  // Heartbeat every 30 seconds to keep Sprite alive
  useEffect(() => {
    if (!sprite?._id || sprite.status !== "running") return;

    const interval = setInterval(() => {
      heartbeat({ spriteId: sprite._id });
    }, 30000);

    return () => clearInterval(interval);
  }, [sprite?._id, sprite?.status, heartbeat]);

  // Stop Sprite on unmount
  useEffect(() => {
    return () => {
      if (sprite?._id && sprite.status === "running") {
        destroyFlyioApp({ spriteId: sprite._id }).catch(console.error);
      }
    };
  }, [sprite?._id, sprite?.status, destroyFlyioApp]);

  // Update current URL when preview URL changes
  useEffect(() => {
    if (sprite?.previewUrl && !currentUrl) {
      setCurrentUrl(sprite.previewUrl);
    }
  }, [sprite?.previewUrl, currentUrl]);

  const phase: SpritePhase = sprite?.status ?? "idle";
  const isLoading = phase === "idle" || phase === "provisioning" || phase === "deploying";
  const isRunning = phase === "running";
  const isError = phase === "error";
  const isStopped = phase === "stopped";

  const handleRetry = async () => {
    if (!sprite?._id) return;
    setProvisioningInitiated(false);
  };

  const handleStop = async () => {
    if (!sprite?._id) return;
    try {
      await stop({ spriteId: sprite._id });
      await destroyFlyioApp({ spriteId: sprite._id });
    } catch (err) {
      console.error("Failed to stop sprite:", err);
    }
  };

  const handleStart = async () => {
    setProvisioningInitiated(false);
    setCurrentUrl(null);
  };

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    }`;

  // No session selected
  if (!sessionId) {
    return (
      <div className="flex h-full flex-col bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          <span className="text-xs text-zinc-400">Fly.io Sprite</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/20">
              <FlyioLogo className="h-6 w-6 text-purple-400" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Select or create a session to start the Fly.io preview
            </p>
          </div>
        </div>
      </div>
    );
  }

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
          onClick={() => setView("logs")}
          className={tabClass(view === "logs")}
        >
          Logs
        </button>
        <div className="flex-1" />
        {isRunning && (
          <button
            onClick={handleStop}
            className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/20"
          >
            Stop
          </button>
        )}
      </div>

      {/* Content area */}
      {view === "logs" ? (
        <div className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
          <div className="text-zinc-500">
            {sprite ? (
              <>
                <div>App: {sprite.appName}</div>
                <div>Status: {sprite.status}</div>
                {sprite.machineId && <div>Machine: {sprite.machineId}</div>}
                {sprite.previewUrl && <div>URL: {sprite.previewUrl}</div>}
                {sprite.errorMessage && (
                  <div className="mt-2 text-red-400">Error: {sprite.errorMessage}</div>
                )}
              </>
            ) : (
              <div>No Sprite provisioned yet</div>
            )}
          </div>
        </div>
      ) : isRunning && sprite?.previewUrl && currentUrl ? (
        <>
          {/* Nav bar */}
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <button
              onClick={() => iframeRef.current?.contentWindow?.history.back()}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Back"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              onClick={() => iframeRef.current?.contentWindow?.history.forward()}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Forward"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <button
              onClick={() => {
                if (iframeRef.current) {
                  iframeRef.current.src = currentUrl;
                }
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Refresh"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
            <div className="flex-1 rounded bg-zinc-800 px-3 py-1">
              <span className="text-xs text-zinc-400">{currentUrl}</span>
            </div>
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Open in new tab"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
          <iframe
            ref={iframeRef}
            src={currentUrl}
            title="Fly.io Preview"
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
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Failed to start Fly.io Sprite
          </h3>
          <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
            {sprite?.errorMessage ?? "An unknown error occurred"}
          </p>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-400 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && sprite && (
            <div className="w-full max-w-lg rounded bg-zinc-100 p-3 font-mono text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              <div>App: {sprite.appName}</div>
              <div>Status: {sprite.status}</div>
              {sprite.errorMessage && (
                <div className="mt-2 text-red-400">{sprite.errorMessage}</div>
              )}
            </div>
          )}
          <button
            onClick={handleRetry}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Retry
          </button>
        </div>
      ) : isStopped ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
            <FlyioLogo className="h-6 w-6 text-zinc-500" />
          </div>
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Sprite Stopped
          </h3>
          <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
            The Fly.io Sprite has been stopped to save resources.
          </p>
          <button
            onClick={handleStart}
            className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            Start Sprite
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-purple-900/20">
            <FlyioLogo className="h-8 w-8 text-purple-400 animate-pulse" />
          </div>
          <BootProgressStepper phase={phase} />
          <p className="mt-4 text-xs text-zinc-500">
            Fly.io Sprites may take 30-60 seconds to start
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/20">
              <FlyioLogo className="h-6 w-6 text-purple-400" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Send a message to start the Fly.io preview
            </p>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <FlyioLogo className="h-3.5 w-3.5 text-purple-400" />
          <p
            className={`text-xs ${
              isRunning
                ? "text-purple-400"
                : isError
                  ? "text-red-500 dark:text-red-400"
                  : isLoading
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            {isRunning && sprite?.previewUrl
              ? `Running on ${sprite.previewUrl}`
              : isError
                ? "Error — see details above"
                : isLoading
                  ? <PhaseLabel phase={phase} />
                  : isStopped
                    ? "Sprite stopped"
                    : "Fly.io Sprite"}
          </p>
        </div>
      </div>
    </div>
  );
}
