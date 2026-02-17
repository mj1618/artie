"use client";

import { useState } from "react";

interface PreviewNavBarProps {
  previewUrl: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onNavigate: (url: string) => void;
  onRefreshFromGitHub?: () => void;
  refreshing?: boolean;
}

export function PreviewNavBar({
  previewUrl,
  iframeRef,
  onNavigate,
  onRefreshFromGitHub,
  refreshing,
}: PreviewNavBarProps) {
  const [urlInput, setUrlInput] = useState(previewUrl);

  // Keep input in sync when previewUrl changes externally
  const [lastPreviewUrl, setLastPreviewUrl] = useState(previewUrl);
  if (previewUrl !== lastPreviewUrl) {
    setLastPreviewUrl(previewUrl);
    setUrlInput(previewUrl);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    // If user typed a relative path, resolve it against the base URL
    let targetUrl = trimmed;
    if (trimmed.startsWith("/")) {
      try {
        const base = new URL(previewUrl);
        targetUrl = `${base.origin}${trimmed}`;
      } catch {
        targetUrl = trimmed;
      }
    }

    onNavigate(targetUrl);
  }

  function handleRefresh() {
    if (iframeRef.current) {
      // Force reload by resetting src
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = "";
      iframeRef.current.src = currentSrc;
    }
  }

  function handleBack() {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // Cross-origin restriction — silently ignore
    }
  }

  function handleForward() {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // Cross-origin restriction — silently ignore
    }
  }

  function handleOpenInNewTab() {
    window.open(previewUrl, "_blank");
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-paper-400 bg-paper-200 px-2 py-1.5">
      {/* Back */}
      <button
        onClick={handleBack}
        title="Back"
        className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path
            fillRule="evenodd"
            d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.56 7.5h5.69a.75.75 0 0 1 0 1.5H7.56l2.22 2.22a.75.75 0 1 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 0Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Forward */}
      <button
        onClick={handleForward}
        title="Forward"
        className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path
            fillRule="evenodd"
            d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06-1.06L8.44 9H2.75a.75.75 0 0 1 0-1.5h5.69L6.22 5.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Refresh */}
      <button
        onClick={handleRefresh}
        title="Refresh"
        className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path
            fillRule="evenodd"
            d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Refresh from GitHub */}
      {onRefreshFromGitHub && (
        <button
          onClick={onRefreshFromGitHub}
          disabled={refreshing}
          title="Pull latest files from GitHub"
          className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshing ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-paper-500 border-t-paper-800" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M8 1a.75.75 0 0 1 .75.75V6.5h2.47a.75.75 0 0 1 .53 1.28l-3.22 3.22a.75.75 0 0 1-1.06 0L4.25 7.78a.75.75 0 0 1 .53-1.28H7.25V1.75A.75.75 0 0 1 8 1Z" />
              <path d="M2.75 9.5a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-1.5a.75.75 0 0 1 .75-.75Z" />
            </svg>
          )}
        </button>
      )}

      {/* URL input */}
      <form onSubmit={handleSubmit} className="flex-1">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="w-full rounded bg-paper-300 px-2.5 py-1 font-mono text-xs text-paper-700 outline-none ring-1 ring-paper-400 focus:ring-paper-500"
          spellCheck={false}
        />
      </form>

      {/* Open in new tab */}
      <button
        onClick={handleOpenInNewTab}
        title="Open in new tab"
        className="rounded p-1 text-paper-600 hover:bg-paper-300 hover:text-paper-800"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path d="M8.75 3.5a.75.75 0 0 0 0 1.5h2.44L7.22 8.97a.75.75 0 1 0 1.06 1.06L12.25 6.06v2.44a.75.75 0 0 0 1.5 0v-4.25a.75.75 0 0 0-.75-.75h-4.25Z" />
          <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
        </svg>
      </button>
    </div>
  );
}
