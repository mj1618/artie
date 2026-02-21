"use client";

import { Id } from "../../../convex/_generated/dataModel";
import { DockerPreview } from "./DockerPreview";

interface PreviewPanelProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

export function PreviewPanel({ repoId, sessionId, branch }: PreviewPanelProps) {
  return <DockerPreview repoId={repoId} sessionId={sessionId} branch={branch} />;
}
