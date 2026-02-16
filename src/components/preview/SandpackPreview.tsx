"use client";

import { Id } from "../../../convex/_generated/dataModel";

interface SandpackPreviewProps {
  repoId: Id<"repos">;
  sessionId: Id<"sessions"> | null;
  branch?: string;
}

/**
 * SandpackPreview renders Sandpack with Nodebox in an iframe.
 * Nodebox is a self-contained Node.js runtime that can run Next.js apps
 * and doesn't have the COEP issues of the standard Sandpack bundler.
 */
export function SandpackPreview({
  repoId,
  sessionId,
  branch,
}: SandpackPreviewProps) {
  // Build the iframe URL with query params
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (branch) params.set("branch", branch);
  
  const iframeSrc = `/sandpack-frame/${repoId}${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <iframe
      src={iframeSrc}
      title="Sandpack Preview"
      className="h-full w-full border-0"
      allow="cross-origin-isolated"
    />
  );
}
