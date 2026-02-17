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
  options?: { branch?: string },
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
  const bootedBranchRef = useRef<string | undefined>(undefined);
  const containerRef = useRef<Awaited<ReturnType<typeof getWebContainer>> | null>(null);

  const fileChanges = useQuery(
    api.fileChanges.listBySession,
    sessionId ? { sessionId } : "skip",
  );

  const boot = useCallback(async () => {
    if (startedRef.current) return;
    // If we have a sessionId but branch is undefined, wait for session to load
    // to avoid booting with wrong branch then immediately rebooting
    if (sessionId && options?.branch === undefined) return;
    startedRef.current = true;
    bootedBranchRef.current = options?.branch;

    try {
      setState((s) => ({ ...s, phase: "booting", error: null }));
      const container = await getWebContainer();
      containerRef.current = container;

      setState((s) => ({ ...s, phase: "fetching" }));

      // Fetch files from GitHub
      const result = await fetchRepoFiles({ repoId, branch: options?.branch });
      const { files, resolvedBranch, didFallback } = result as {
        files: FileSystemTree;
        resolvedBranch: string;
        didFallback: boolean;
      };

      if (didFallback) {
        console.log(
          `[useWorkspaceContainer] Branch fallback occurred (${options?.branch} → ${resolvedBranch})`
        );
      }

      setState((s) => ({ ...s, phase: "mounting" }));
      await loadFiles(container, files);

      await startDevServer(
        container,
        (devState: Partial<DevServerState>) => {
          setState((s) => ({
            ...s,
            phase: (devState.status as ContainerPhase) ?? s.phase,
            previewUrl: devState.url ?? s.previewUrl,
            error: devState.error ?? s.error,
            output: devState.output ?? s.output,
          }));
        }
      );
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Failed to start preview",
      }));
    }
  }, [repoId, sessionId, fetchRepoFiles, options?.branch]);

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
      const result = await fetchRepoFiles({ repoId, branch: options?.branch });
      const { files } = result as {
        files: FileSystemTree;
        resolvedBranch: string;
        didFallback: boolean;
      };

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

      let filesToMount = files;
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
  }, [state.phase, fetchRepoFiles, repoId, fileChanges, options?.branch]);

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

  // When branch changes after initial boot, teardown and reboot
  useEffect(() => {
    if (!startedRef.current) return;
    // Don't tear down if branch becomes undefined (e.g., session data temporarily unavailable)
    // Only reboot when branch changes to a different defined value
    if (options?.branch === undefined) return;
    if (options?.branch === bootedBranchRef.current) return;

    startedRef.current = false;
    containerRef.current = null;
    teardownWebContainer();
    setState({
      phase: "idle",
      previewUrl: null,
      error: null,
      output: [],
    });
  }, [options?.branch]);

  useEffect(() => {
    boot();
  }, [boot]);

  return { ...state, retry, refreshFiles, refreshing };
}
