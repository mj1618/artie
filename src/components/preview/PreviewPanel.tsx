"use client";

import { Id } from "../../../convex/_generated/dataModel";
import { ParticlePreview } from "./ParticlePreview";

interface PreviewPanelProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
  runtime?: string;
}

export function PreviewPanel({ repoId, sessionId, branch }: PreviewPanelProps) {
  return <ParticlePreview repoId={repoId} sessionId={sessionId} branch={branch} />;
}
