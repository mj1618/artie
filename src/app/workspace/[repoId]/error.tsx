"use client";

import Link from "next/link";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper-100 px-6">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-red-900/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-7 w-7 text-red-400"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-paper-950">Something went wrong</h2>
      <p className="mt-2 max-w-md text-center text-sm text-paper-600">
        {error.message || "An unexpected error occurred in the workspace."}
      </p>
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={reset}
          className="rounded-md bg-paper-700 px-4 py-2 text-sm font-medium text-paper-50 hover:bg-paper-300"
        >
          Try again
        </button>
        <Link
          href="/home"
          className="text-sm text-paper-600 hover:text-paper-950"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
