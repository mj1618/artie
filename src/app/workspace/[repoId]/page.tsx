"use client";

import { useState, useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { SplitPane } from "@/components/layout/SplitPane";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export default function WorkspacePage() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const router = useRouter();
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId as Id<"repos">;
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);
  const [initialized, setInitialized] = useState(false);

  const repo = useQuery(
    api.projects.get,
    isAuthenticated ? { repoId } : "skip",
  );

  const sessions = useQuery(
    api.sessions.listByRepo,
    isAuthenticated ? { repoId } : "skip",
  );

  // Default to the most recent session on first load
  useEffect(() => {
    if (initialized || !sessions) return;
    if (sessions.length > 0) {
      setSessionId(sessions[0]._id);
    }
    setInitialized(true);
  }, [sessions, initialized]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
      </div>
    );
  }

  if (!isAuthenticated) {
    router.push("/login");
    return null;
  }

  if (repo === undefined || sessions === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
      </div>
    );
  }

  if (repo === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-950 text-white">
        <p className="mb-4 text-lg">Repository not found</p>
        <Link href="/home" className="text-sm text-zinc-400 hover:text-white">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <Header
        repoName={`${repo.githubOwner}/${repo.githubRepo}`}
        branchName={repo.defaultBranch}
      />
      <SplitPane
        left={
          <ChatPanel
            repoId={repoId}
            sessions={sessions}
            initialSessionId={sessionId}
            onSessionChange={setSessionId}
          />
        }
        right={<PreviewPanel repoId={repoId} sessionId={sessionId} />}
      />
    </div>
  );
}
