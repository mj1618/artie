"use client";

import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { ReviewTab } from "./ReviewTab";

interface ParticlePreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

type ParticleStatus =
  | "requested"
  | "creating"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "active"
  | "stopping"
  | "destroyed"
  | "unhealthy";

type DisplayPhase =
  | "idle"
  | "requested"
  | "creating"
  | "cloning"
  | "installing"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "error";

function BootProgressStepper({ phase }: { phase: DisplayPhase }) {
  const steps = [
    { key: "requested", label: "Queued" },
    { key: "creating", label: "Creating VM" },
    { key: "cloning", label: "Cloning repository" },
    { key: "installing", label: "Installing dependencies" },
    { key: "starting", label: "Starting dev server" },
    { key: "ready", label: "Ready" },
  ];

  const phaseToStep: Record<string, number> = {
    idle: -1,
    requested: 0,
    creating: 1,
    cloning: 2,
    installing: 3,
    starting: 4,
    ready: 5,
    stopping: 5,
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20">
                <svg
                  className="h-3.5 w-3.5 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
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

            <span
              className={`text-sm ${
                isComplete
                  ? "text-blue-400"
                  : isCurrent
                    ? "text-paper-900"
                    : "text-paper-400"
              }`}
            >
              {step.label}
              {isCurrent && "..."}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getFriendlyErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();
  const stripped = raw.replace(/<[^>]*>/g, "").trim();

  if (lower.includes("not found") || lower.includes("404")) {
    return "The particle could not be found. It may have been stopped or deleted.";
  }
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("networkerror")) {
    return "Could not connect to the Particle API. Please try again.";
  }
  if (lower.includes("api_key") || lower.includes("not configured")) {
    return "The Particle API is not configured. An administrator needs to set up the credentials.";
  }
  if (lower.includes("github token") || lower.includes("github connection")) {
    return "Your GitHub connection has expired. Please reconnect GitHub in your settings.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The particle took too long to start. This may be a temporary issue — try again.";
  }
  if (lower.includes("clone failed")) {
    return "Failed to clone the repository. Please check your GitHub connection.";
  }
  if (lower.includes("install failed")) {
    return "Failed to install dependencies. Check your package.json for issues.";
  }

  if (stripped.length > 200 || raw.includes("<")) {
    return "The particle encountered an error during startup. Click 'Show details' for more information.";
  }

  return stripped || "An unknown error occurred";
}

function ParticleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
    </svg>
  );
}

function StatusHistoryLogs({
  statusHistory,
  buildLog,
}: {
  statusHistory?: Array<{ status: string; timestamp: number; reason?: string }>;
  buildLog?: string;
}) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [statusHistory, buildLog, autoScroll]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-paper-100">
      <div className="flex items-center justify-between px-3 py-2 border-b border-paper-300 bg-paper-200">
        <span className="text-xs text-paper-500">Build Logs</span>
        <label className="flex items-center gap-1 text-xs text-paper-500 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-3 h-3"
          />
          Auto-scroll
        </label>
      </div>

      <div
        className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          const isAtBottom =
            target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
          if (!isAtBottom && autoScroll) {
            setAutoScroll(false);
          }
        }}
      >
        {buildLog ? (
          <pre className="whitespace-pre-wrap text-paper-600">{buildLog}</pre>
        ) : statusHistory && statusHistory.length > 0 ? (
          statusHistory.map((entry, i) => {
            const lower = entry.status.toLowerCase();
            const isError = lower.includes("unhealthy") || (entry.reason?.toLowerCase().includes("failed"));
            const isSuccess = lower.includes("ready");

            return (
              <div
                key={i}
                className={
                  isError
                    ? "text-red-500"
                    : isSuccess
                      ? "text-green-600"
                      : "text-paper-600"
                }
              >
                <span className="text-paper-400 select-none mr-2">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                {entry.status}
                {entry.reason && (
                  <span className="text-paper-400"> ({entry.reason})</span>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-paper-400 italic">Waiting for logs...</div>
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

function LlmLogsPanel({ rawOutput }: { rawOutput?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const len = rawOutput?.length ?? 0;
    if (len > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLenRef.current = len;
  }, [rawOutput]);

  if (!rawOutput) {
    return (
      <div className="flex flex-1 items-center justify-center bg-paper-100 text-paper-400 text-sm">
        No LLM output yet. Send a message to see the raw response.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto bg-paper-100 p-3 font-mono text-xs leading-relaxed text-paper-700"
    >
      <div className="mb-2 text-paper-400 text-[10px]">
        Claude CLI output (live)
      </div>
      <pre className="whitespace-pre-wrap break-all">{rawOutput}</pre>
    </div>
  );
}

export function ParticlePreview({
  repoId,
  sessionId,
  branch,
}: ParticlePreviewProps) {
  const [view, setView] = useState<"preview" | "logs" | "llm" | "review">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [requestInitiated, setRequestInitiated] = useState(false);
  const prevParticleIdRef = useRef<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const offlineCountRef = useRef(0);
  const [isRecovering, setIsRecovering] = useState(false);

  const particle = useQuery(
    api.particles.getForPreview,
    sessionId ? { sessionId, repoId, branch } : "skip"
  );

  const latestRawOutput = useQuery(
    api.messages.getLatestRawOutput,
    sessionId ? { sessionId } : "skip"
  );

  const request = useMutation(api.particles.request);
  const heartbeat = useMutation(api.particles.heartbeat);
  const requestStop = useMutation(api.particles.requestStop);
  const updatePreviewUrl = useMutation(api.sessions.updatePreviewUrl);

  useEffect(() => {
    if (!sessionId || requestInitiated) return;

    async function initParticle() {
      try {
        await request({ sessionId: sessionId!, branch });
        setRequestInitiated(true);
      } catch (err) {
        console.error("Failed to request Particle:", err);
      }
    }

    initParticle();
  }, [sessionId, branch, requestInitiated, request]);

  useEffect(() => {
    if (!particle?._id) return;

    const status = particle.status as ParticleStatus;
    if (status !== "ready" && status !== "active") return;

    heartbeat({ particleId: particle._id }).catch(console.error);

    const interval = setInterval(() => {
      heartbeat({ particleId: particle._id }).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, [particle?._id, particle?.status, heartbeat]);

  const prevPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const particleId = particle?._id ?? null;
    const previewUrl = particle?.previewUrl ?? null;

    if (particleId !== prevParticleIdRef.current) {
      prevParticleIdRef.current = particleId;
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true);
      if (previewUrl && sessionId) {
        updatePreviewUrl({ sessionId, url: previewUrl });
      }
    } else if (previewUrl && previewUrl !== prevPreviewUrlRef.current) {
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true);
      if (sessionId) {
        updatePreviewUrl({ sessionId, url: previewUrl });
      }
    }
  }, [particle?._id, particle?.previewUrl, sessionId, updatePreviewUrl]);

  useEffect(() => {
    const status = particle?.status as ParticleStatus | undefined;
    const previewUrl = particle?.previewUrl;

    if ((status !== "ready" && status !== "active") || !previewUrl) {
      offlineCountRef.current = 0;
      return;
    }

    const checkConnectivity = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch(previewUrl, {
          method: "HEAD",
          mode: "no-cors",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        setIsOnline(true);
        offlineCountRef.current = 0;
      } catch {
        offlineCountRef.current++;
        setIsOnline(false);

        // Grace period: don't auto-recover for the first 2 minutes after particle becomes ready
        const statusChangedAt = particle?.statusChangedAt ?? 0;
        const timeSinceReady = Date.now() - statusChangedAt;
        const gracePeriodMs = 2 * 60 * 1000;

        if (offlineCountRef.current >= 6 && particle?._id && !isRecovering && timeSinceReady > gracePeriodMs) {
          console.log("[ParticlePreview] Particle offline for 30s (past grace period), auto-recovering...");
          setIsRecovering(true);
          requestStop({ particleId: particle._id, reason: "auto_recovery_offline" })
            .then(() => {
              setTimeout(() => {
                setRequestInitiated(false);
                setCurrentUrl(null);
                prevParticleIdRef.current = null;
                setIsRecovering(false);
                offlineCountRef.current = 0;
              }, 2000);
            })
            .catch((err) => {
              console.error("[ParticlePreview] Auto-recovery failed:", err);
              setIsRecovering(false);
            });
        }
      }
    };

    checkConnectivity();
    const interval = setInterval(checkConnectivity, 5000);

    return () => clearInterval(interval);
  }, [particle?.status, particle?.previewUrl, particle?._id, particle?.statusChangedAt, isRecovering, requestStop]);

  const computePhase = (): DisplayPhase => {
    const status = particle?.status as ParticleStatus | undefined;

    if (!status || status === "destroyed") return "stopped";
    if (status === "unhealthy") return "error";
    if (status === "stopping") return "stopping";
    if (status === "ready" || status === "active") return "ready";
    if (status === "starting") return "starting";
    if (status === "installing") return "installing";
    if (status === "cloning") return "cloning";
    if (status === "creating") return "creating";
    if (status === "requested") return "requested";

    return "idle";
  };

  const phase = computePhase();
  const isLoading =
    phase === "idle" ||
    phase === "requested" ||
    phase === "creating" ||
    phase === "cloning" ||
    phase === "installing" ||
    phase === "starting";
  const isRunning = phase === "ready";
  const isError = phase === "error";
  const isStopped = phase === "stopped";
  const isStopping = phase === "stopping";

  const handleRetry = () => {
    setRequestInitiated(false);
    setCurrentUrl(null);
    prevParticleIdRef.current = null;
  };

  const handleStop = async () => {
    if (!particle?._id) return;
    try {
      await requestStop({ particleId: particle._id, reason: "user_requested" });
    } catch (err) {
      console.error("Failed to stop particle:", err);
    }
  };

  const handleStart = () => {
    setRequestInitiated(false);
    setCurrentUrl(null);
    prevParticleIdRef.current = null;
  };

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-paper-200 text-paper-950 dark:bg-paper-700 dark:text-paper-200"
        : "text-paper-500 hover:text-paper-400 dark:text-paper-600 dark:hover:text-paper-800"
    }`;

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col bg-paper-700 dark:bg-paper-100">
        <div className="flex items-center gap-1 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
          <span className="text-xs text-paper-600">Preview</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <ParticleLogo className="h-6 w-6 text-blue-400" />
            </div>
            <p className="text-sm text-paper-500 dark:text-paper-600">
              Select or create a session to start the preview
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-paper-700 dark:bg-paper-100">
      <div className="flex items-center gap-1 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
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
        <button
          onClick={() => setView("llm")}
          className={tabClass(view === "llm")}
        >
          LLM Output
        </button>
        <button
          onClick={() => setView("review")}
          className={tabClass(view === "review")}
        >
          Review
        </button>
        <div className="flex-1" />
        {(isRunning || isLoading) && !isStopping && (
          <button
            onClick={handleStop}
            className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/20"
          >
            Stop
          </button>
        )}
      </div>

      {view === "review" ? (
        <ReviewTab sessionId={sessionId} />
      ) : view === "logs" ? (
        <StatusHistoryLogs
          statusHistory={particle?.statusHistory}
          buildLog={particle?.buildLog}
        />
      ) : view === "llm" ? (
        <LlmLogsPanel rawOutput={latestRawOutput?.rawOutput} />
      ) : isRunning && particle?.previewUrl && currentUrl ? (
        <>
          <div className="flex items-center gap-2 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
            <button
              onClick={() => iframeRef.current?.contentWindow?.history.back()}
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
              title="Back"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              onClick={() => iframeRef.current?.contentWindow?.history.forward()}
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
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
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
              title="Refresh"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
            <div className="flex-1 rounded bg-paper-300 px-3 py-1">
              <span className="text-xs text-paper-600">{currentUrl}</span>
            </div>
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
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
            title="Preview"
            className="flex-1 w-full bg-white"
            style={{ border: "none" }}
          />
        </>
      ) : isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-red-500">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Failed to start
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            {getFriendlyErrorMessage(particle?.errorMessage ?? "")}
          </p>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-paper-500 hover:text-paper-400 dark:text-paper-400 dark:hover:text-paper-600 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && particle && (
            <div className="w-full max-w-lg rounded bg-paper-700 p-3 font-mono text-xs text-paper-400 dark:bg-paper-100 dark:text-paper-600 max-h-80 overflow-auto">
              <div>Name: {particle.particleName}</div>
              <div>Status: {particle.status}</div>
              <div>Retry Count: {particle.retryCount}</div>
              {particle.errorMessage && (
                <div className="mt-2 text-red-400">{particle.errorMessage}</div>
              )}
              {particle.buildLog && (
                <div className="mt-2 border-t border-paper-500 pt-2">
                  <div className="text-paper-500 mb-1">Build Log:</div>
                  <pre className="whitespace-pre-wrap">{particle.buildLog}</pre>
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleRetry}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          >
            Try Again
          </button>
        </div>
      ) : isStopped ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-100 dark:bg-paper-900/30">
            <ParticleLogo className="h-6 w-6 text-paper-400" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            VM stopped
          </h3>
          <p className="text-sm text-paper-400 dark:text-paper-600">
            The particle has been shut down
          </p>
          <button
            onClick={handleStart}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          >
            Start New VM
          </button>
        </div>
      ) : isStopping ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-100 dark:bg-paper-900/30 animate-pulse">
            <ParticleLogo className="h-6 w-6 text-paper-400" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Stopping...
          </h3>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20 animate-pulse">
            <ParticleLogo className="h-6 w-6 text-blue-400" />
          </div>
          <BootProgressStepper phase={phase} />
          {!isOnline && (
            <div className="text-xs text-yellow-500">
              Server appears to be restarting...
            </div>
          )}
          {particle?._id && (
            <button
              onClick={handleStop}
              className="mt-2 rounded border border-paper-400 px-4 py-1.5 text-sm text-paper-400 hover:border-red-400 hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <ParticleLogo className="h-6 w-6 text-blue-400" />
            </div>
            <p className="text-sm text-paper-500 dark:text-paper-600">
              Initializing...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
