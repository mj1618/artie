"use client";

import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { ReviewTab } from "./ReviewTab";

interface FirecrackerPreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

type FirecrackerStatus =
  | "requested"
  | "creating"
  | "booting"
  | "cloning"
  | "installing"
  | "starting"
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
  | "booting"
  | "cloning"
  | "installing"
  | "starting"
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
      return <span>Creating VM...</span>;
    case "booting":
      return <span>Booting VM...</span>;
    case "cloning":
      return <span>Cloning repository...</span>;
    case "installing":
      return <span>Installing dependencies...</span>;
    case "starting":
      return <span>Starting dev server...</span>;
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
    { key: "creating", label: "Creating VM" },
    { key: "booting", label: "Booting VM" },
    { key: "cloning", label: "Cloning repository" },
    { key: "installing", label: "Installing dependencies" },
    { key: "starting", label: "Starting dev server" },
    { key: "ready", label: "Ready" },
  ];

  const phaseToStep: Record<string, number> = {
    idle: -1,
    requested: 0,
    creating: 1,
    booting: 2,
    cloning: 3,
    installing: 4,
    starting: 5,
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20">
                <svg
                  className="h-3.5 w-3.5 text-amber-400"
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-400 animate-pulse">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
              </div>
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-paper-400">
                <div className="h-2 w-2 rounded-full bg-paper-400" />
              </div>
            )}

            <span
              className={`text-sm ${
                isComplete
                  ? "text-amber-400"
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

  // Strip HTML tags to extract the actual error text
  const stripped = raw.replace(/<[^>]*>/g, "").trim();

  if (lower.includes("cannot post") || lower.includes("cannot get") || lower.includes("404")) {
    return "The Firecracker host API endpoint is not available. The host may need to be updated with the latest API endpoints.";
  }
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("networkerror")) {
    return "Could not connect to the Firecracker host. The host may be down or unreachable.";
  }
  if (lower.includes("api_secret") || lower.includes("not configured")) {
    return "The Firecracker host is not configured. An administrator needs to set up the API credentials.";
  }
  if (lower.includes("github token") || lower.includes("github connection")) {
    return "Your GitHub connection has expired. Please reconnect GitHub in your settings.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The VM took too long to start. This may be a temporary issue — try again.";
  }
  if (lower.includes("max") && lower.includes("retries")) {
    return "The VM failed to start after multiple attempts. Please try again later.";
  }

  // If the message is very long or contains HTML, return a generic message
  if (stripped.length > 200 || raw.includes("<")) {
    return "The VM encountered an error during startup. Click 'Show details' for more information.";
  }

  return stripped || "An unknown error occurred";
}

function FirecrackerLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2c.5 0 1 .2 1.3.6l1.5 2.2c.2.3.5.5.8.6l2.5.7c.8.2 1.3 1 1.1 1.8l-.5 2.6c-.1.3 0 .7.2 1l1.6 2.1c.5.6.4 1.5-.2 2l-2.1 1.6c-.3.2-.5.5-.5.9l-.2 2.6c-.1.9-.8 1.5-1.7 1.4l-2.6-.3c-.3 0-.7.1-1 .3l-2.1 1.5c-.7.5-1.5.3-2-.3L6.5 17c-.2-.3-.5-.5-.8-.6l-2.5-.7c-.8-.2-1.3-1-1.1-1.8l.5-2.6c.1-.3 0-.7-.2-1L.8 8.2C.3 7.6.4 6.7 1 6.2l2.1-1.6c.3-.2.5-.5.5-.9l.2-2.6C3.9.2 4.6-.4 5.5-.3l2.6.3c.3 0 .7-.1 1-.3L11.2.2c.2-.1.5-.2.8-.2z" />
    </svg>
  );
}

// Logs tab with SSE streaming (falls back to status history)
function FirecrackerLogs({
  logsUrl,
  apiSecret,
  statusHistory,
}: {
  logsUrl?: string;
  apiSecret?: string;
  statusHistory?: Array<{ status: string; timestamp: number; reason?: string }>;
}) {
  const [logs, setLogs] = useState<Array<{ line: string; timestamp: number }>>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!logsUrl || !apiSecret) return;

    const url = `${logsUrl}?token=${encodeURIComponent(apiSecret)}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setConnected(true);
      setConnectionError(false);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLogs((prev) => [...prev.slice(-500), data]);
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      setConnectionError(true);
    };

    return () => eventSource.close();
  }, [logsUrl, apiSecret]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-paper-100">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-paper-300 bg-paper-200">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected
                ? "bg-green-500"
                : connectionError
                  ? "bg-red-500"
                  : "bg-yellow-500 animate-pulse"
            }`}
          />
          <span className="text-xs text-paper-500">
            {connected
              ? "Connected"
              : connectionError
                ? "Connection failed — showing status history"
                : "Connecting..."}
          </span>
        </div>
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

      {/* Log content */}
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
        {logs.length > 0 ? (
          logs.map((entry, i) => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const line = entry.line;
            const isError =
              line.toLowerCase().includes("error") ||
              line.toLowerCase().includes("failed");
            const isWarning = line.toLowerCase().includes("warn");
            const isSuccess =
              line.toLowerCase().includes("ready") ||
              line.toLowerCase().includes("listening");

            return (
              <div
                key={i}
                className={
                  isError
                    ? "text-red-500"
                    : isWarning
                      ? "text-yellow-600"
                      : isSuccess
                        ? "text-green-600"
                        : "text-paper-600"
                }
              >
                <span className="text-paper-400 select-none mr-2">{time}</span>
                {line}
              </div>
            );
          })
        ) : statusHistory && statusHistory.length > 0 ? (
          <>
            <div className="text-paper-400 italic mb-2">
              SSE logs not available yet — showing status history:
            </div>
            {statusHistory.map((entry, i) => (
              <div key={i} className="text-paper-600">
                <span className="text-paper-400 select-none mr-2">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                {entry.status}
                {entry.reason && (
                  <span className="text-paper-400"> ({entry.reason})</span>
                )}
              </div>
            ))}
          </>
        ) : (
          <div className="text-paper-400 italic">Waiting for logs...</div>
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

// Terminal tab with xterm.js WebSocket
function FirecrackerTerminalInner({
  terminalUrl,
  apiSecret,
}: {
  terminalUrl: string;
  apiSecret: string;
}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  
  // Use refs to track initialization state to prevent re-initialization
  const initializedRef = useRef(false);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);

  useEffect(() => {
    // Prevent re-initialization if already initialized with same URL
    if (initializedRef.current) return;
    if (!terminalRef.current) return;

    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    async function initTerminal() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // @ts-expect-error -- CSS import handled by Next.js bundler
      await import("@xterm/xterm/css/xterm.css");

      if (!terminalRef.current || initializedRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: "#1a1a1a",
          foreground: "#e0e0e0",
          cursor: "#ffffff",
        },
      });
      termRef.current = term;

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      const url = `${terminalUrl}?token=${encodeURIComponent(apiSecret)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        term.write(
          "\r\n\x1b[32mConnected to Firecracker VM\x1b[0m\r\n\r\n"
        );
      };

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          term.write(e.data);
        } else if (e.data instanceof Blob) {
          e.data.text().then((text) => term.write(text));
        }
      };

      ws.onerror = () => setStatus("error");
      ws.onclose = () => setStatus("disconnected");

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Throttle resize observer to prevent excessive fit() calls
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          fitAddonRef.current?.fit();
        }, 100);
      });
      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      initializedRef.current = true;
    }

    initTerminal().catch(() => setStatus("error"));

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver?.disconnect();
      wsRef.current?.close();
      termRef.current?.dispose();
      initializedRef.current = false;
      termRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalUrl, apiSecret]);

  return (
    <div className="flex flex-col flex-1 bg-[#1a1a1a]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-paper-700">
        <div
          className={`w-2 h-2 rounded-full ${
            status === "connected"
              ? "bg-green-500"
              : status === "connecting"
                ? "bg-yellow-500 animate-pulse"
                : "bg-red-500"
          }`}
        />
        <span className="text-xs text-paper-400">
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting..."
              : status === "error"
                ? "Connection error — host API terminal not available yet"
                : "Disconnected"}
        </span>
      </div>
      <div ref={terminalRef} className="flex-1" />
    </div>
  );
}

// Memoize the terminal to prevent re-renders when parent updates
const FirecrackerTerminal = React.memo(FirecrackerTerminalInner);

export function FirecrackerPreview({
  repoId,
  sessionId,
  branch,
}: FirecrackerPreviewProps) {
  const [view, setView] = useState<"preview" | "logs" | "terminal" | "llm" | "review">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [requestInitiated, setRequestInitiated] = useState(false);
  const prevVmIdRef = useRef<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Query the VM for this session or an active one on the same branch
  const vm = useQuery(
    api.firecrackerVms.getForPreview,
    sessionId ? { sessionId, repoId, branch } : "skip"
  );

  // Query the latest raw LLM output for debugging
  const latestRawOutput = useQuery(
    api.messages.getLatestRawOutput,
    sessionId ? { sessionId } : "skip"
  );

  // Mutations
  const request = useMutation(api.firecrackerVms.request);
  const heartbeat = useMutation(api.firecrackerVms.heartbeat);
  const requestStop = useMutation(api.firecrackerVms.requestStop);

  // Auto-request VM when session is available
  useEffect(() => {
    if (!sessionId || requestInitiated) return;

    async function initVm() {
      try {
        await request({ sessionId: sessionId!, branch });
        setRequestInitiated(true);
      } catch (err) {
        console.error("Failed to request Firecracker VM:", err);
      }
    }

    initVm();
  }, [sessionId, branch, requestInitiated, request]);

  // Heartbeat every 30 seconds when ready/active
  useEffect(() => {
    if (!vm?._id) return;

    const status = vm.status as FirecrackerStatus;
    if (status !== "ready" && status !== "active") return;

    heartbeat({ vmId: vm._id }).catch(console.error);

    const interval = setInterval(() => {
      heartbeat({ vmId: vm._id }).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, [vm?._id, vm?.status, heartbeat]);

  // Track the last previewUrl we synced to detect changes
  const prevPreviewUrlRef = useRef<string | null>(null);

  // Update current URL when preview URL changes or VM changes
  useEffect(() => {
    const vmId = vm?._id ?? null;
    const previewUrl = vm?.previewUrl ?? null;
    
    // If VM changed (new VM assigned or previous one destroyed), reset URL
    if (vmId !== prevVmIdRef.current) {
      prevVmIdRef.current = vmId;
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true); // Reset online status for new VM
    } else if (previewUrl && previewUrl !== prevPreviewUrlRef.current) {
      // Same VM but previewUrl changed (e.g., port updated) - sync it
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true); // Reset online status when URL changes
    }
  }, [vm?._id, vm?.previewUrl]);

  // Connectivity check - periodically ping the preview URL
  useEffect(() => {
    const status = vm?.status as FirecrackerStatus | undefined;
    const previewUrl = vm?.previewUrl;
    
    // Only check connectivity when VM is ready/active and has a preview URL
    if ((status !== "ready" && status !== "active") || !previewUrl) {
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
      } catch {
        setIsOnline(false);
      }
    };

    // Initial check
    checkConnectivity();

    // Check every 5 seconds
    const interval = setInterval(checkConnectivity, 5000);

    return () => clearInterval(interval);
  }, [vm?.status, vm?.previewUrl]);

  // Map VM status to display phase
  const computePhase = (): DisplayPhase => {
    const status = vm?.status as FirecrackerStatus | undefined;

    if (!status || status === "destroyed") return "stopped";
    if (status === "unhealthy") return "error";
    if (status === "stopping" || status === "destroying") return "stopping";
    if (status === "ready" || status === "active") return "ready";
    if (status === "starting") return "starting";
    if (status === "installing") return "installing";
    if (status === "cloning") return "cloning";
    if (status === "booting") return "booting";
    if (status === "creating") return "creating";
    if (status === "requested") return "requested";

    return "idle";
  };

  const phase = computePhase();
  const isLoading =
    phase === "idle" ||
    phase === "requested" ||
    phase === "creating" ||
    phase === "booting" ||
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
    prevVmIdRef.current = null;
  };

  const handleStop = async () => {
    if (!vm?._id) return;
    try {
      await requestStop({ vmId: vm._id, reason: "user_requested" });
    } catch (err) {
      console.error("Failed to stop VM:", err);
    }
  };

  const handleStart = () => {
    setRequestInitiated(false);
    setCurrentUrl(null);
    prevVmIdRef.current = null;
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
          <span className="text-xs text-paper-600">Firecracker VM</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-900/20">
              <FirecrackerLogo className="h-6 w-6 text-amber-400" />
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
        <button
          onClick={() => setView("terminal")}
          className={tabClass(view === "terminal")}
        >
          Terminal
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

      {/* Content area */}
      {view === "review" ? (
        <ReviewTab sessionId={sessionId} />
      ) : view === "logs" ? (
        <FirecrackerLogs
          logsUrl={vm?.logsUrl}
          apiSecret={vm?.apiSecret}
          statusHistory={vm?.statusHistory}
        />
      ) : view === "terminal" ? (
        vm?.terminalUrl && vm?.apiSecret ? (
          <FirecrackerTerminal
            key={vm.terminalUrl}
            terminalUrl={vm.terminalUrl}
            apiSecret={vm.apiSecret}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[#1a1a1a]">
            <p className="text-sm text-paper-400">
              {isLoading
                ? "Terminal will be available once the VM is ready..."
                : "No terminal connection available"}
            </p>
          </div>
        )
      ) : view === "llm" ? (
        <div className="flex-1 overflow-auto bg-paper-100 p-3 font-mono text-xs leading-relaxed text-paper-700">
          {latestRawOutput?.rawOutput ? (
            <>
              <div className="mb-2 text-paper-400 text-[10px]">
                Latest LLM response (raw output for debugging)
              </div>
              <pre className="whitespace-pre-wrap break-all">{latestRawOutput.rawOutput}</pre>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-paper-400">
              No LLM output yet. Send a message to see the raw response.
            </div>
          )}
        </div>
      ) : isRunning && vm?.previewUrl && currentUrl ? (
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
            title="Firecracker Preview"
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
            Failed to start VM
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            {getFriendlyErrorMessage(vm?.errorMessage ?? "")}
          </p>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-paper-500 hover:text-paper-400 dark:text-paper-400 dark:hover:text-paper-600 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && vm && (
            <div className="w-full max-w-lg rounded bg-paper-700 p-3 font-mono text-xs text-paper-400 dark:bg-paper-100 dark:text-paper-600">
              <div>Name: {vm.vmName}</div>
              <div>Status: {vm.status}</div>
              <div>Retry Count: {vm.retryCount}</div>
              {vm.errorMessage && (
                <div className="mt-2 text-red-400">{vm.errorMessage}</div>
              )}
              <div className="mt-2 border-t border-paper-500 pt-2">
                <div className="font-semibold mb-1">Recent History:</div>
                {vm.statusHistory.slice(-5).map(
                  (
                    entry: {
                      status: string;
                      timestamp: number;
                      reason?: string;
                    },
                    i: number
                  ) => (
                    <div key={i}>
                      {new Date(entry.timestamp).toLocaleTimeString()} -{" "}
                      {entry.status}
                      {entry.reason && ` (${entry.reason})`}
                    </div>
                  )
                )}
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
            <FirecrackerLogo className="h-6 w-6 text-paper-500" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            VM Stopped
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            The VM has been stopped to save resources.
          </p>
          <button
            onClick={handleStart}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            Start VM
          </button>
        </div>
      ) : isStopping ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-900/20">
            <FirecrackerLogo className="h-8 w-8 text-yellow-400 animate-pulse" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Stopping VM
          </h3>
          <p className="text-sm text-paper-400 dark:text-paper-600">
            Please wait while the VM is being shut down...
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-amber-900/20">
            <FirecrackerLogo className="h-8 w-8 text-amber-400 animate-pulse" />
          </div>
          <BootProgressStepper phase={phase} />
          <p className="mt-4 text-xs text-paper-500">
            Firecracker VMs boot in seconds
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-900/20">
              <FirecrackerLogo className="h-6 w-6 text-amber-400" />
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
          <FirecrackerLogo className={`h-3.5 w-3.5 ${isRunning && !isOnline ? "text-red-500" : "text-amber-400"}`} />
          <p
            className={`text-xs ${
              isRunning && !isOnline
                ? "text-red-500 dark:text-red-400"
                : isRunning
                  ? "text-amber-400"
                  : isError
                    ? "text-red-500 dark:text-red-400"
                    : isLoading || isStopping
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-paper-600 dark:text-paper-500"
            }`}
          >
            {isRunning && vm?.previewUrl ? (
              isOnline ? (
                `Running on ${vm.previewUrl}`
              ) : (
                <>Offline — {vm.previewUrl}</>
              )
            ) : isError ? (
              "Error — see details above"
            ) : isLoading ? (
              <PhaseLabel phase={phase} />
            ) : isStopping ? (
              "Stopping..."
            ) : isStopped ? (
              "VM stopped"
            ) : (
              "Firecracker VM"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
