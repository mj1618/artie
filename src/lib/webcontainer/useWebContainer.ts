"use client";

import { useState, useEffect, useRef } from "react";
import { WebContainer } from "@webcontainer/api";
import { getWebContainer } from "./index";

export type WebContainerStatus = "idle" | "booting" | "ready" | "error";

export function useWebContainer() {
  const [status, setStatus] = useState<WebContainerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<WebContainer | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setStatus("booting");
      setError(null);
      try {
        const container = await getWebContainer();
        if (!cancelled) {
          containerRef.current = container;
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to boot WebContainer",
          );
          setStatus("error");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    container: containerRef.current,
    status,
    error,
  };
}
