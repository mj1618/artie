"use client";

import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { ReviewTab } from "./ReviewTab";

interface DockerPreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

type DockerStatus =
  | "requested"
  | "creating"
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
      return <span>Creating container...</span>;
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
    { key: "creating", label: "Creating container" },
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

  if (lower.includes("cannot post") || lower.includes("cannot get") || lower.includes("404")) {
    return "The Docker host API endpoint is not available. The host may need to be updated.";
  }
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("networkerror")) {
    return "Could not connect to the Docker host. The host may be down or unreachable.";
  }
  if (lower.includes("api_secret") || lower.includes("not configured")) {
    return "The Docker host is not configured. An administrator needs to set up the API credentials.";
  }
  if (lower.includes("github token") || lower.includes("github connection")) {
    return "Your GitHub connection has expired. Please reconnect GitHub in your settings.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The container took too long to start. This may be a temporary issue — try again.";
  }
  if (lower.includes("max") && lower.includes("retries")) {
    return "The container failed to start after multiple attempts. Please try again later.";
  }

  if (stripped.length > 200 || raw.includes("<")) {
    return "The container encountered an error during startup. Click 'Show details' for more information.";
  }

  return stripped || "An unknown error occurred";
}

function DockerLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186h-2.12a.186.186 0 00-.185.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.185v1.888c0 .102.084.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z" />
    </svg>
  );
}

function useDockerLogs(logsUrl?: string, apiSecret?: string) {
  const [logs, setLogs] = useState<Array<{ line: string; timestamp: number }>>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(false);

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

  return { logs, connected, connectionError };
}

function LogLines({
  logs,
  statusHistory,
  connected,
  connectionError,
}: {
  logs: Array<{ line: string; timestamp: number }>;
  statusHistory?: Array<{ status: string; timestamp: number; reason?: string }>;
  connected: boolean;
  connectionError: boolean;
}) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-paper-100">
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

// Logs tab with SSE streaming (falls back to status history)
function DockerLogs({
  logsUrl,
  apiSecret,
  statusHistory,
}: {
  logsUrl?: string;
  apiSecret?: string;
  statusHistory?: Array<{ status: string; timestamp: number; reason?: string }>;
}) {
  const { logs, connected, connectionError } = useDockerLogs(logsUrl, apiSecret);

  return (
    <LogLines
      logs={logs}
      statusHistory={statusHistory}
      connected={connected}
      connectionError={connectionError}
    />
  );
}

// Terminal tab with xterm.js WebSocket
function DockerTerminalInner({
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
  
  const initializedRef = useRef(false);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);

  useEffect(() => {
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
          "\r\n\x1b[34mConnected to Docker container\x1b[0m\r\n\r\n"
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

const DockerTerminal = React.memo(DockerTerminalInner);

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

export function DockerPreview({
  repoId,
  sessionId,
  branch,
}: DockerPreviewProps) {
  const [view, setView] = useState<"preview" | "logs" | "terminal" | "llm" | "review">("preview");
  const [showDetails, setShowDetails] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [requestInitiated, setRequestInitiated] = useState(false);
  const prevContainerIdRef = useRef<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const offlineCountRef = useRef(0);
  const [isRecovering, setIsRecovering] = useState(false);

  const container = useQuery(
    api.dockerContainers.getForPreview,
    sessionId ? { sessionId, repoId, branch } : "skip"
  );

  const latestRawOutput = useQuery(
    api.messages.getLatestRawOutput,
    sessionId ? { sessionId } : "skip"
  );

  const request = useMutation(api.dockerContainers.request);
  const heartbeat = useMutation(api.dockerContainers.heartbeat);
  const requestStop = useMutation(api.dockerContainers.requestStop);

  useEffect(() => {
    if (!sessionId || requestInitiated) return;

    async function initContainer() {
      try {
        await request({ sessionId: sessionId!, branch });
        setRequestInitiated(true);
      } catch (err) {
        console.error("Failed to request Docker container:", err);
      }
    }

    initContainer();
  }, [sessionId, branch, requestInitiated, request]);

  useEffect(() => {
    if (!container?._id) return;

    const status = container.status as DockerStatus;
    if (status !== "ready" && status !== "active") return;

    heartbeat({ containerId: container._id }).catch(console.error);

    const interval = setInterval(() => {
      heartbeat({ containerId: container._id }).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, [container?._id, container?.status, heartbeat]);

  const prevPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const containerId = container?._id ?? null;
    const previewUrl = container?.previewUrl ?? null;
    
    if (containerId !== prevContainerIdRef.current) {
      prevContainerIdRef.current = containerId;
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true);
    } else if (previewUrl && previewUrl !== prevPreviewUrlRef.current) {
      prevPreviewUrlRef.current = previewUrl;
      setCurrentUrl(previewUrl);
      setIsOnline(true);
    }
  }, [container?._id, container?.previewUrl]);

  useEffect(() => {
    const status = container?.status as DockerStatus | undefined;
    const previewUrl = container?.previewUrl;

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

        // After 6 consecutive failures (30s), auto-recover by stopping
        // the stale container so a new one can be requested
        if (offlineCountRef.current >= 6 && container?._id && !isRecovering) {
          console.log("[DockerPreview] Container offline for 30s, auto-recovering...");
          setIsRecovering(true);
          requestStop({ containerId: container._id, reason: "auto_recovery_offline" })
            .then(() => {
              // After a brief pause, trigger a fresh start
              setTimeout(() => {
                setRequestInitiated(false);
                setCurrentUrl(null);
                prevContainerIdRef.current = null;
                setIsRecovering(false);
                offlineCountRef.current = 0;
              }, 2000);
            })
            .catch((err) => {
              console.error("[DockerPreview] Auto-recovery failed:", err);
              setIsRecovering(false);
            });
        }
      }
    };

    checkConnectivity();
    const interval = setInterval(checkConnectivity, 5000);

    return () => clearInterval(interval);
  }, [container?.status, container?.previewUrl, container?._id, isRecovering, requestStop]);

  const computePhase = (): DisplayPhase => {
    const status = container?.status as DockerStatus | undefined;

    if (!status || status === "destroyed") return "stopped";
    if (status === "unhealthy") return "error";
    if (status === "stopping" || status === "destroying") return "stopping";
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
    prevContainerIdRef.current = null;
  };

  const handleStop = async () => {
    if (!container?._id) return;
    try {
      await requestStop({ containerId: container._id, reason: "user_requested" });
    } catch (err) {
      console.error("Failed to stop container:", err);
    }
  };

  const handleStart = () => {
    setRequestInitiated(false);
    setCurrentUrl(null);
    prevContainerIdRef.current = null;
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
          <span className="text-xs text-paper-600">Docker Container</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <DockerLogo className="h-6 w-6 text-blue-400" />
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

      {view === "review" ? (
        <ReviewTab sessionId={sessionId} />
      ) : view === "logs" ? (
        <DockerLogs
          logsUrl={container?.logsUrl}
          apiSecret={container?.apiSecret}
          statusHistory={container?.statusHistory}
        />
      ) : view === "terminal" ? (
        container?.terminalUrl && container?.apiSecret ? (
          <DockerTerminal
            key={container.terminalUrl}
            terminalUrl={container.terminalUrl}
            apiSecret={container.apiSecret}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[#1a1a1a]">
            <p className="text-sm text-paper-400">
              {isLoading
                ? "Terminal will be available once the container is ready..."
                : "No terminal connection available"}
            </p>
          </div>
        )
      ) : view === "llm" ? (
        <LlmLogsPanel rawOutput={latestRawOutput?.rawOutput} />
      ) : isRunning && container?.previewUrl && currentUrl ? (
        <>
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
            title="Docker Preview"
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
            Failed to start container
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            {getFriendlyErrorMessage(container?.errorMessage ?? "")}
          </p>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-paper-500 hover:text-paper-400 dark:text-paper-400 dark:hover:text-paper-600 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && container && (
            <div className="w-full max-w-lg rounded bg-paper-700 p-3 font-mono text-xs text-paper-400 dark:bg-paper-100 dark:text-paper-600 max-h-80 overflow-auto">
              <div>Name: {container.containerName}</div>
              <div>Status: {container.status}</div>
              <div>Retry Count: {container.retryCount}</div>
              {container.errorMessage && (
                <div className="mt-2 text-red-400">{container.errorMessage}</div>
              )}
              {container.buildLog && (
                <div className="mt-2 border-t border-paper-500 pt-2">
                  <div className="font-semibold mb-1">Build Log:</div>
                  <pre className="whitespace-pre-wrap break-words text-paper-400 dark:text-paper-500 max-h-48 overflow-auto bg-paper-800 dark:bg-paper-50 rounded p-2">
                    {container.buildLog}
                  </pre>
                </div>
              )}
              <div className="mt-2 border-t border-paper-500 pt-2">
                <div className="font-semibold mb-1">Recent History:</div>
                {container.statusHistory.slice(-5).map(
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
            <DockerLogo className="h-6 w-6 text-paper-500" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Container Stopped
          </h3>
          <p className="max-w-sm text-center text-sm text-paper-400 dark:text-paper-600">
            The container has been stopped to save resources.
          </p>
          <button
            onClick={handleStart}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Start Container
          </button>
        </div>
      ) : isStopping ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-900/20">
            <DockerLogo className="h-8 w-8 text-yellow-400 animate-pulse" />
          </div>
          <h3 className="text-base font-semibold text-paper-200 dark:text-paper-800">
            Stopping Container
          </h3>
          <p className="text-sm text-paper-400 dark:text-paper-600">
            Please wait while the container is being shut down...
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900/20">
              <DockerLogo className="h-5 w-5 text-blue-400 animate-pulse" />
            </div>
            <BootProgressStepper phase={phase} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-900/20">
              <DockerLogo className="h-6 w-6 text-blue-400" />
            </div>
            <p className="text-sm text-paper-500 dark:text-paper-600">
              Send a message to start the preview
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-paper-600 px-4 py-2 dark:border-paper-300">
        <div className="flex items-center gap-2">
          <DockerLogo className={`h-3.5 w-3.5 ${isRunning && !isOnline ? "text-red-500" : "text-blue-400"}`} />
          <p
            className={`text-xs ${
              isRunning && !isOnline
                ? "text-red-500 dark:text-red-400"
                : isRunning
                  ? "text-blue-400"
                  : isError
                    ? "text-red-500 dark:text-red-400"
                    : isLoading || isStopping
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-paper-600 dark:text-paper-500"
            }`}
          >
            {isRunning && container?.previewUrl ? (
              isOnline ? (
                `Running on ${container.previewUrl}`
              ) : isRecovering ? (
                "Reconnecting — restarting container..."
              ) : (
                <>Offline — {container.previewUrl}</>
              )
            ) : isError ? (
              "Error — see details above"
            ) : isLoading ? (
              <PhaseLabel phase={phase} />
            ) : isStopping ? (
              "Stopping..."
            ) : isStopped ? (
              "Container stopped"
            ) : (
              "Docker Container"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
