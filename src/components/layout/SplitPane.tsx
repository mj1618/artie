"use client";

import { ReactNode, useRef, useState, useEffect } from "react";

export function SplitPane({
  left,
  right,
  leftLabel = "Chat",
  rightLabel = "Preview",
}: {
  left: ReactNode;
  right: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(35);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState<"left" | "right">("left");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile]);

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const divider = dividerRef.current;
    if (!divider) return;
    
    divider.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onPointerMove(e: PointerEvent) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const minPct = (300 / rect.width) * 100;
      const clamped = Math.min(60, Math.max(minPct, pct));
      setLeftWidth(clamped);
    }

    function onPointerUp(e: PointerEvent) {
      divider!.releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      divider!.removeEventListener("pointermove", onPointerMove);
      divider!.removeEventListener("pointerup", onPointerUp);
    }

    divider.addEventListener("pointermove", onPointerMove);
    divider.addEventListener("pointerup", onPointerUp);
  }

  if (isMobile) {
    const tabClass = (active: boolean) =>
      `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-paper-200 text-paper-950 dark:bg-paper-700 dark:text-paper-200"
          : "text-paper-500 hover:text-paper-400 dark:text-paper-600 dark:hover:text-paper-800"
      }`;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-paper-600 px-3 py-1.5 dark:border-paper-300">
          <button
            onClick={() => setActiveTab("left")}
            className={tabClass(activeTab === "left")}
          >
            {leftLabel}
          </button>
          <button
            onClick={() => setActiveTab("right")}
            className={tabClass(activeTab === "right")}
          >
            {rightLabel}
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto ${activeTab !== "left" ? "hidden" : ""}`}>
          {left}
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto ${activeTab !== "right" ? "hidden" : ""}`}>
          {right}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div
        className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
        style={{ width: collapsed ? "0%" : `${leftWidth}%` }}
      >
        {left}
      </div>
      <div
        ref={dividerRef}
        onPointerDown={collapsed ? undefined : onDividerPointerDown}
        className={`group relative shrink-0 ${
          collapsed
            ? "w-1 cursor-default bg-paper-500 dark:bg-paper-400"
            : "w-1 cursor-col-resize bg-paper-600 transition-colors hover:bg-paper-400 dark:bg-paper-400 dark:hover:bg-paper-500"
        }`}
      >
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex h-6 w-4 items-center justify-center rounded-sm bg-paper-500 text-paper-500 hover:bg-paper-400 hover:text-paper-400 dark:bg-paper-400 dark:text-paper-600 dark:hover:bg-paper-400 dark:hover:text-paper-800 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={collapsed ? "Expand chat panel" : "Collapse chat panel"}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            )}
          </svg>
        </button>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {right}
      </div>
    </div>
  );
}
