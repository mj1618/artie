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
  const [leftWidth, setLeftWidth] = useState(35);
  const isDragging = useRef(false);
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
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const minPct = (300 / rect.width) * 100;
      const clamped = Math.min(60, Math.max(minPct, pct));
      setLeftWidth(clamped);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function onDividerMouseDown() {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  if (isMobile) {
    const tabClass = (active: boolean) =>
      `rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
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
        className="overflow-y-auto"
        style={{ width: `${leftWidth}%` }}
      >
        {left}
      </div>
      <div
        onMouseDown={onDividerMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-zinc-200 transition-colors hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-500"
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {right}
      </div>
    </div>
  );
}
