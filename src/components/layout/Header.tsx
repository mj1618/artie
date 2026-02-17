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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-paper-300 bg-paper-200 px-4 text-paper-950">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="text-lg font-bold tracking-tight hover:text-paper-700"
        >
          Artie
        </Link>
        {repoName && (
          <>
            <span className="text-paper-400">/</span>
            <span className="text-sm text-paper-700">{repoName}</span>
            {branchName && (
              <span className="rounded bg-paper-300 px-1.5 py-0.5 text-xs text-paper-600">
                {branchName}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="text-sm text-paper-600 hover:text-paper-950"
        >
          Settings
        </Link>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-400 text-xs font-medium text-paper-900">
          {initial}
        </div>
        <button
          onClick={() => void signOut()}
          className="text-sm text-paper-600 hover:text-paper-950"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
