"use client";

import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function Header({
  repoName,
  branchName,
}: {
  repoName?: string;
  branchName?: string;
}) {
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.currentUser);

  const initial = user?.email
    ? user.email.charAt(0).toUpperCase()
    : user?.name
      ? user.name.charAt(0).toUpperCase()
      : "U";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-paper-300 bg-paper-100 px-4 text-paper-950 shadow-paper-sm">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="text-lg font-bold tracking-tight text-paper-900 transition-colors hover:text-sepia"
        >
          Composure
        </Link>
        {repoName && (
          <>
            <span className="text-paper-400">/</span>
            <span className="text-sm font-medium text-paper-700">{repoName}</span>
            {branchName && (
              <span className="rounded-md bg-paper-200 px-2 py-0.5 text-xs font-medium text-paper-600 ring-1 ring-paper-300">
                {branchName}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <Link
          href="/settings"
          className="text-sm text-paper-600 transition-colors hover:text-paper-900"
        >
          Settings
        </Link>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sepia text-xs font-semibold text-paper-50 shadow-paper-sm">
          {initial}
        </div>
        <button
          onClick={() => void signOut()}
          className="text-sm text-paper-600 transition-colors hover:text-paper-900"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
