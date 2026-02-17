"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

interface LogsResponse {
  logs: string;
  lineCount: number;
  latestTimestamp: number;
  hasMore: boolean;
}

interface DropletPreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

// Single unified status (matches backend)
type DropletStatus =
  | "requested"
  | "creating"
  | "create_failed"
  | "provisioning"
  | "booting"
  | "cloning"
  | "installing"
  | "ready"
  | "active"
  | "stopping"
  | "destroying"
  | "destroyed"
  | "unhealthy";

type DisplayPhase =
  | "idle"
  | "requested"
  | "creating"
  | "provisioning"
  | "booting"
  | "cloning"
  | "installing"
  | "ready"
  | "stopping"
  | "stopped"
  | "error";

function PhaseLabel({ phase }: { phase: DisplayPhase }) {
  switch (phase) {
    case "idle":
      return <span>Waiting to start...</span>;
    case "requested":
      return <span>Queued for creation...</span>;
    case "creating":
      return <span>Creating droplet...</span>;
    case "provisioning":
      return <span>Provisioning droplet...</span>;
    case "booting":
      return <span>Booting container...</span>;
    case "cloning":
      return <span>Cloning repository...</span>;
    case "installing":
      return <span>Installing dependencies...</span>;
    case "ready":
      return <span>Running</span>;
    case "stopping":
      return <span>Stopping...</span>;
    case "stopped":
      return <span>Stopped</span>;
    case "error":
      return <span>Error</span>;
  }
}

function BootProgressStepper({ phase }: { phase: DisplayPhase }) {
  const steps = [
    { key: "requested", label: "Queued" },
    { key: "creating", label: "Creating droplet" },
    { key: "provisioning", label: "Provisioning" },
    { key: "booting", label: "Booting container" },
    { key: "cloning", label: "Cloning repository" },
    { key: "installing", label: "Installing dependencies" },
    { key: "ready", label: "Ready" },
  ];

  const phaseToStep: Record<string, number> = {
    idle: -1,
    requested: 0,
    creating: 1,
    provisioning: 2,
    booting: 3,
    cloning: 4,
    installing: 5,
    ready: 6,
    stopping: 6,
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

function DigitalOceanLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 0C5.408-.02.005 5.37.005 11.992h4.638c0-4.923 4.882-8.731 10.064-6.855a6.95 6.95 0 014.147 4.148c1.889 5.177-1.924 10.055-6.84 10.064v-4.61H7.391v4.623h4.61V24c7.86 0 13.665-7.322 11.53-15.497C22.392 4.396 19.6 1.604 15.495.47A12.003 12.003 0 0012.04 0zM7.39 19.362H3.828v3.564H7.39v-3.564zm-3.563 0v-2.978H.85v2.978h2.978z" />
    </svg>
  );
}

export function DropletPreview({
  repoId,
  sessionId,
  branch,
}: DropletPreviewProps) {
  const [view, setView] = useState<"preview" | "logs">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  
  // Logs state
  const [logs, setLogs] = useState<string>("");
  const [logsError, setLogsError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Query the droplet for this session or an active one on the same branch
  const droplet = useQuery(
    api.droplets.getForPreview,
    sessionId ? { sessionId, repoId, branch } : "skip"
  );

  // Mutations - no actions needed, backend handles lifecycle
  const request = useMutation(api.droplets.request);
  const heartbeat = useMutation(api.droplets.heartbeat);
  const requestStop = useMutation(api.droplets.requestStop);

  // Track if we've initiated the request
  const [requestInitiated, setRequestInitiated] = useState(false);

  // Auto-request droplet when session is available
  useEffect(() => {
    if (!sessionId || requestInitiated) return;

    async function initDroplet() {
      try {
        await request({ sessionId: sessionId!, branch });
        setRequestInitiated(true);
      } catch (err) {
        console.error("Failed to request droplet:", err);
      }
    }

    initDroplet();
  }, [sessionId, branch, requestInitiated, request]);

  // Heartbeat every 30 seconds when ready/active
  // This is the ONLY thing the frontend needs to do for lifecycle management
  useEffect(() => {
    if (!droplet?._id) return;

    const status = droplet.status as DropletStatus;
    if (status !== "ready" && status !== "active") return;

    // Send initial heartbeat immediately
    heartbeat({ dropletId: droplet._id }).catch(console.error);

    const interval = setInterval(() => {
      heartbeat({ dropletId: droplet._id }).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, [droplet?._id, droplet?.status, heartbeat]);

  // NOTE: No cleanup on unmount! Backend handles timeouts via scheduler.
  // This prevents resource leaks if browser crashes or closes unexpectedly.

  // Update current URL when preview URL changes
  useEffect(() => {
    if (droplet?.previewUrl && !currentUrl) {
      setCurrentUrl(droplet.previewUrl);
    }
  }, [droplet?.previewUrl, currentUrl]);

  // Fetch logs from the droplet's API
  const fetchLogs = useCallback(async () => {
    if (!droplet?.apiUrl || !droplet?.apiSecret) return;
    
    try {
      const response = await fetch(`${droplet.apiUrl}/logs?tail=500`, {
        headers: {
          Authorization: `Bearer ${droplet.apiSecret}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: LogsResponse = await response.json();
      setLogs(data.logs);
      setLogsError(null);
    } catch (err) {
      // Don't show error if droplet is still booting
      const status = droplet?.status as DropletStatus;
      if (status === "ready" || status === "active") {
        setLogsError(err instanceof Error ? err.message : "Failed to fetch logs");
      }
    }
  }, [droplet?.apiUrl, droplet?.apiSecret, droplet?.status]);

  // Poll logs when viewing logs tab and droplet is running
  useEffect(() => {
    if (view !== "logs") return;
    
    const status = droplet?.status as DropletStatus;
    const shouldPoll = status === "cloning" || status === "installing" || status === "ready" || status === "active" || status === "booting";
    
    if (!shouldPoll || !droplet?.apiUrl) return;

    // Fetch immediately
    fetchLogs();

    // Poll every 2 seconds
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [view, droplet?.status, droplet?.apiUrl, fetchLogs]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Map droplet status to display phase
  const computePhase = (): DisplayPhase => {
    const status = droplet?.status as DropletStatus | undefined;

    if (!status || status === "destroyed") return "stopped";
    if (status === "unhealthy" || status === "create_failed") return "error";
    if (status === "stopping" || status === "destroying") return "stopping";
    if (status === "ready" || status === "active") return "ready";
    if (status === "installing") return "installing";
    if (status === "cloning") return "cloning";
    if (status === "booting") return "booting";
    if (status === "provisioning") return "provisioning";
    if (status === "creating") return "creating";
    if (status === "requested") return "requested";

    return "idle";
  };

  const phase = computePhase();
  const isLoading =
    phase === "idle" ||
    phase === "requested" ||
    phase === "creating" ||
    phase === "provisioning" ||
    phase === "booting" ||
    phase === "cloning" ||
    phase === "installing";
  const isRunning = phase === "ready";
  const isError = phase === "error";
  const isStopped = phase === "stopped";
  const isStopping = phase === "stopping";

  const handleRetry = async () => {
    setRequestInitiated(false);
  };

  const handleStop = async () => {
    if (!droplet?._id) return;
    try {
      await requestStop({ dropletId: droplet._id, reason: "user_requested" });
    } catch (err) {
      console.error("Failed to stop droplet:", err);
    }
  };

  const handleStart = async () => {
    setRequestInitiated(false);
    setCurrentUrl(null);
  };

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-paper-200 text-paper-950 dark:bg-paper-700 dark:text-paper-200"
        : "text-paper-500 hover:text-paper-400 dark:text-paper-600 dark:hover:text-paper-800"
    }`;

  // No session selected
  if (!sessionId) {
    return (
      <div className="flex h-full flex-col bg-paper-700 dark:bg-paper-100">
        <div className="flex items-center gap-1 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
          <span className="text-xs text-paper-600">DigitalOcean Droplet</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <DigitalOceanLogo className="h-6 w-6 text-blue-400" />
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
      {/* Toggle bar */}
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

      {/* Content area */}
      {view === "logs" ? (
        <div className="flex flex-col flex-1 overflow-hidden bg-paper-100">
          {/* Logs header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-paper-300 bg-paper-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-paper-600">
                {droplet?.dropletName || "Dev Server"}
              </span>
              {droplet && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  droplet.status === "ready" || droplet.status === "active" 
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : droplet.status === "unhealthy" || droplet.status === "create_failed"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                }`}>
                  {droplet.status}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-paper-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-3 h-3"
                />
                Auto-scroll
              </label>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-paper-500 hover:text-paper-700 underline"
              >
                {showDetails ? "Hide info" : "Show info"}
              </button>
            </div>
          </div>
          
          {/* Droplet info (collapsible) */}
          {showDetails && droplet && (
            <div className="px-3 py-2 border-b border-paper-300 bg-paper-150 text-xs text-paper-500 space-y-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>Region: {droplet.region}</div>
                <div>Size: {droplet.size}</div>
                {droplet.ipv4Address && <div>IP: {droplet.ipv4Address}</div>}
                {droplet.previewUrl && <div>URL: {droplet.previewUrl}</div>}
              </div>
              {droplet.errorMessage && (
                <div className="text-red-400">Error: {droplet.errorMessage}</div>
              )}
            </div>
          )}
          
          {/* Logs content */}
          <div 
            className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed"
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
              if (!isAtBottom && autoScroll) {
                setAutoScroll(false);
              }
            }}
          >
            {logsError ? (
              <div className="text-red-400">
                Failed to load logs: {logsError}
              </div>
            ) : logs ? (
              <div className="whitespace-pre-wrap text-paper-700">
                {logs.split("\n").map((line, i) => {
                  // Parse timestamp from log line format: [timestamp] message
                  const match = line.match(/^\[(\d+)\]\s*(.*)$/);
                  if (match) {
                    const timestamp = new Date(parseInt(match[1]) * 1000);
                    const message = match[2];
                    const isError = message.toLowerCase().includes("error") || message.toLowerCase().includes("failed");
                    const isWarning = message.toLowerCase().includes("warn");
                    const isSuccess = message.toLowerCase().includes("ready") || message.toLowerCase().includes("success") || message.toLowerCase().includes("listening");
                    
                    return (
                      <div 
                        key={i} 
                        className={`${
                          isError ? "text-red-500" : 
                          isWarning ? "text-yellow-600" : 
                          isSuccess ? "text-green-600" : 
                          "text-paper-600"
                        }`}
                      >
                        <span className="text-paper-400 select-none">
                          {timestamp.toLocaleTimeString()}
                        </span>
                        {" "}
                        {message}
                      </div>
                    );
                  }
                  return <div key={i} className="text-paper-600">{line}</div>;
                })}
                <div ref={logsEndRef} />
              </div>
            ) : droplet ? (
              <div className="text-paper-400 italic">
                {isLoading ? "Waiting for logs..." : "No logs available yet"}
              </div>
            ) : (
              <div className="text-paper-400">No droplet provisioned yet</div>
            )}
          </div>
        </div>
      ) : isRunning && droplet?.previewUrl && currentUrl ? (
        <>
          {/* Nav bar */}
          <div className="flex items-center gap-2 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
            <button
              onClick={() => iframeRef.current?.contentWindow?.history.back()}
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
              title="Back"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <button
              onClick={() =>
                iframeRef.current?.contentWindow?.history.forward()
              }
              className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
              title="Forward"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
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
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
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
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          </div>
          <iframe
            ref={iframeRef}
            src={currentUrl}
            title="DigitalOcean Preview"
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
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Failed to start droplet
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            {droplet?.errorMessage ?? "An unknown error occurred"}
          </p>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-paper-500 hover:text-paper-400 dark:text-paper-400 dark:hover:text-paper-600 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && droplet && (
            <div className="w-full max-w-lg rounded bg-paper-700 p-3 font-mono text-xs text-paper-400 dark:bg-paper-100 dark:text-paper-600">
              <div>Name: {droplet.dropletName}</div>
              <div>Status: {droplet.status}</div>
              <div>Retry Count: {droplet.retryCount}</div>
              {droplet.errorMessage && (
                <div className="mt-2 text-red-400">{droplet.errorMessage}</div>
              )}
              <div className="mt-2 border-t border-paper-500 pt-2">
                <div className="font-semibold mb-1">Recent History:</div>
                {droplet.statusHistory.slice(-5).map((entry: { status: string; timestamp: number; reason?: string }, i: number) => (
                  <div key={i}>
                    {new Date(entry.timestamp).toLocaleTimeString()} -{" "}
                    {entry.status}
                    {entry.reason && ` (${entry.reason})`}
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={handleRetry}
            className="rounded bg-paper-200 px-4 py-2 text-sm font-medium text-paper-950 hover:bg-paper-300 dark:bg-paper-700 dark:text-paper-200 dark:hover:bg-paper-600"
          >
            Retry
          </button>
        </div>
      ) : isStopped ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-300">
            <DigitalOceanLogo className="h-6 w-6 text-paper-500" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Droplet Stopped
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            The droplet has been stopped to save resources.
          </p>
          <button
            onClick={handleStart}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Start Droplet
          </button>
        </div>
      ) : isStopping ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-900/20">
            <DigitalOceanLogo className="h-8 w-8 text-yellow-400 animate-pulse" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Stopping Droplet
          </h3>
          <p className="text-sm text-paper-400 dark:text-paper-600">
            Please wait while the droplet is being shut down...
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-blue-900/20">
            <DigitalOceanLogo className="h-8 w-8 text-blue-400 animate-pulse" />
          </div>
          <BootProgressStepper phase={phase} />
          <p className="mt-4 text-xs text-paper-500">
            DigitalOcean droplets may take 1-2 minutes to start
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <DigitalOceanLogo className="h-6 w-6 text-blue-400" />
            </div>
            <p className="text-sm text-paper-500 dark:text-paper-600">
              Send a message to start the preview
            </p>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="border-t border-paper-600 px-4 py-2 dark:border-paper-300">
        <div className="flex items-center gap-2">
          <DigitalOceanLogo className="h-3.5 w-3.5 text-blue-400" />
          <p
            className={`text-xs ${
              isRunning
                ? "text-blue-400"
                : isError
                  ? "text-red-500 dark:text-red-400"
                  : isLoading || isStopping
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-paper-600 dark:text-paper-500"
            }`}
          >
            {isRunning && droplet?.previewUrl ? (
              `Running on ${droplet.previewUrl}`
            ) : isError ? (
              "Error — see details above"
            ) : isLoading ? (
              <PhaseLabel phase={phase} />
            ) : isStopping ? (
              "Stopping..."
            ) : isStopped ? (
              "Droplet stopped"
            ) : (
              "DigitalOcean Droplet"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
