"use client";

import { useState, useEffect, Suspense } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { SplitPane } from "@/components/layout/SplitPane";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

function generateBranchName(featureName: string): string {
  return (
    "feature/" +
    featureName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function NewFeatureDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (featureName: string, branchName: string) => void;
}) {
  const [featureName, setFeatureName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);

  useEffect(() => {
    if (!branchEdited && featureName) {
      setBranchName(generateBranchName(featureName));
    }
  }, [featureName, branchEdited]);

  useEffect(() => {
    if (open) {
      setFeatureName("");
      setBranchName("");
      setBranchEdited(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const canCreate = featureName.trim().length > 0 && branchName.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-paper-400 bg-paper-200 p-6 shadow-xl animate-dialog-in">
        <h2 className="text-lg font-semibold text-paper-950">
          New Feature
        </h2>
        <p className="mb-4 mt-1 text-sm text-paper-600">
          Start working on a new idea. Each feature gets its own conversation and git branch.
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              What are you building?
            </label>
            <input
              type="text"
              value={featureName}
              onChange={(e) => setFeatureName(e.target.value)}
              placeholder="e.g. Update hero section, Add dark mode, Fix login bug"
              autoFocus
              className="w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-2 text-sm text-paper-950 placeholder:text-paper-500 outline-none focus:border-paper-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  onCreate(featureName.trim(), branchName.trim());
                }
              }}
            />
            <p className="mt-1 text-xs text-paper-500">
              Give your feature a short, descriptive name.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              Git branch
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value);
                setBranchEdited(true);
              }}
              placeholder="feature/update-hero-section"
              className="w-full rounded-md border border-paper-400 bg-paper-300 px-3 py-2 text-sm font-mono text-paper-950 placeholder:text-paper-500 outline-none focus:border-paper-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  onCreate(featureName.trim(), branchName.trim());
                }
              }}
            />
            <p className="mt-1 text-xs text-paper-500">
              Auto-generated from the feature name. The branch will be created on GitHub when you push.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-paper-600 hover:text-paper-950"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (canCreate) {
                onCreate(featureName.trim(), branchName.trim());
              }
            }}
            disabled={!canCreate}
            className="rounded-md bg-paper-700 px-4 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-paper-100">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-400 border-t-white" />
        </div>
      }
    >
      <WorkspacePageInner />
    </Suspense>
  );
}

function WorkspacePageInner() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const router = useRouter();
  const params = useParams<{ repoId: string }>();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session") as Id<"sessions"> | null;
  const repoId = params.repoId as Id<"repos">;
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [showNewFeatureDialog, setShowNewFeatureDialog] = useState(false);
  const [pendingBranchInfo, setPendingBranchInfo] = useState<{
    branchName: string;
    featureName: string;
  } | null>(null);

  const createSession = useMutation(api.sessions.create);

  const repo = useQuery(
    api.projects.get,
    isAuthenticated ? { repoId } : "skip",
  );

  const sessions = useQuery(
    api.sessions.listByRepo,
    isAuthenticated ? { repoId } : "skip",
  );

  // Default to the URL session param, or the most recent session on first load
  useEffect(() => {
    if (initialized || !sessions) return;
    if (sessionParam && sessions.some((s) => s._id === sessionParam)) {
      setSessionId(sessionParam);
    } else if (sessions.length > 0) {
      setSessionId(sessions[0]._id);
    }
    setInitialized(true);
  }, [sessions, initialized, sessionParam]);

  // Get the active session to read its branch name
  const activeSession = sessions?.find((s) => s._id === sessionId);
  const activeBranchName =
    activeSession?.branchName ?? repo?.defaultBranch;

  // Keyboard shortcut: Cmd+N / Ctrl+N to open new feature dialog
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowNewFeatureDialog(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNewChatRequest = () => {
    setShowNewFeatureDialog(true);
  };

  const handleCreateFeatureSession = async (
    featureName: string,
    branchName: string,
  ) => {
    setShowNewFeatureDialog(false);
    const newSessionId = await createSession({
      repoId,
      branchName,
      featureName,
    });
    setSessionId(newSessionId);
    setPendingBranchInfo({ branchName, featureName });
    router.replace(`/workspace/${repoId}?session=${newSessionId}`, {
      scroll: false,
    });
  };

  const handleSessionChange = (id: Id<"sessions"> | null) => {
    setSessionId(id);
    // Clear pending branch info when switching sessions
    setPendingBranchInfo(null);
    // Update URL to reflect active session
    if (id) {
      router.replace(`/workspace/${repoId}?session=${id}`, { scroll: false });
    } else {
      router.replace(`/workspace/${repoId}`, { scroll: false });
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-400 border-t-white" />
      </div>
    );
  }

  if (!isAuthenticated) {
    router.push("/login");
    return null;
  }

  if (repo === undefined || sessions === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-400 border-t-white" />
      </div>
    );
  }

  if (repo === null) notFound();

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoName={`${repo.githubOwner}/${repo.githubRepo}`}
        branchName={activeBranchName}
      />
      <SplitPane
        left={
          <ChatPanel
            repoId={repoId}
            sessions={sessions}
            initialSessionId={sessionId}
            onSessionChange={handleSessionChange}
            onNewChatRequest={handleNewChatRequest}
            pendingBranchInfo={pendingBranchInfo}
          />
        }
        right={
          <PreviewPanel
            repoId={repoId}
            sessionId={sessionId}
            branch={activeSession?.branchName}
          />
        }
      />
      <NewFeatureDialog
        open={showNewFeatureDialog}
        onClose={() => setShowNewFeatureDialog(false)}
        onCreate={handleCreateFeatureSession}
      />
    </div>
  );
}
