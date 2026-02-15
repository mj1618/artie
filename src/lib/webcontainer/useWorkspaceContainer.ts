"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAction, useQuery } from "convex/react";
import { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { getWebContainer, teardownWebContainer } from "./index";
import { loadFiles, removePathsFromTree } from "./files";
import { startDevServer, type DevServerState } from "./devServer";
import { FileSystemTree } from "@webcontainer/api";

export type ContainerPhase =
  | "idle"
  | "booting"
  | "fetching"
  | "mounting"
  | "installing"
  | "starting"
  | "running"
  | "error";

export interface WorkspaceContainerState {
  phase: ContainerPhase;
  previewUrl: string | null;
  error: string | null;
  output: string[];
}

export function useWorkspaceContainer(
  repoId: Id<"repos">,
  sessionId: Id<"sessions"> | null,
) {
  const [state, setState] = useState<WorkspaceContainerState>({
    phase: "idle",
    previewUrl: null,
    error: null,
    output: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const fetchRepoFiles = useAction(api.github.fetchRepoForWebContainer);
  const startedRef = useRef(false);
  const containerRef = useRef<Awaited<ReturnType<typeof getWebContainer>> | null>(null);

  const fileChanges = useQuery(
    api.fileChanges.listBySession,
    sessionId ? { sessionId } : "skip",
  );

  const boot = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      setState((s) => ({ ...s, phase: "booting", error: null }));
      const container = await getWebContainer();
      containerRef.current = container;

      setState((s) => ({ ...s, phase: "fetching" }));
      const fileTree = await fetchRepoFiles({ repoId });

      setState((s) => ({ ...s, phase: "mounting" }));
      await loadFiles(container, fileTree as any);

      await startDevServer(container, (devState: Partial<DevServerState>) => {
        setState((s) => ({
          ...s,
          phase: (devState.status as ContainerPhase) ?? s.phase,
          previewUrl: devState.url ?? s.previewUrl,
          error: devState.error ?? s.error,
          output: devState.output ?? s.output,
        }));
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Failed to start preview",
      }));
    }
  }, [repoId, fetchRepoFiles]);

  const refreshFiles = useCallback(async (): Promise<{
    success: boolean;
    skippedCount: number;
    error?: string;
  }> => {
    if (!containerRef.current || state.phase !== "running") {
      return { success: false, skippedCount: 0, error: "Container not running" };
    }

    setRefreshing(true);
    try {
      const freshFiles = await fetchRepoFiles({ repoId });

      // Collect paths that have pending (non-reverted) file changes
      const pendingPaths = new Set<string>();
      if (fileChanges) {
        for (const change of fileChanges) {
          if (change.reverted) continue;
          for (const file of change.files) {
            pendingPaths.add(file.path);
          }
        }
      }

      let filesToMount = freshFiles as FileSystemTree;
      if (pendingPaths.size > 0) {
        filesToMount = removePathsFromTree(filesToMount, pendingPaths);
      }

      await loadFiles(containerRef.current, filesToMount);
      setRefreshing(false);
      return { success: true, skippedCount: pendingPaths.size };
    } catch (err) {
      setRefreshing(false);
      return {
        success: false,
        skippedCount: 0,
        error: err instanceof Error ? err.message : "Failed to refresh files",
      };
    }
  }, [state.phase, fetchRepoFiles, repoId, fileChanges]);

  const retry = useCallback(() => {
    startedRef.current = false;
    containerRef.current = null;
    teardownWebContainer();
    setState({
      phase: "idle",
      previewUrl: null,
      error: null,
      output: [],
    });
    boot();
  }, [boot]);

  useEffect(() => {
    boot();
  }, [boot]);

  return { ...state, retry, refreshFiles, refreshing };
}
