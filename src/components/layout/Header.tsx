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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 text-white">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="text-lg font-bold tracking-tight hover:text-zinc-300"
        >
          Artie
        </Link>
        {repoName && (
          <>
            <span className="text-zinc-600">/</span>
            <span className="text-sm text-zinc-300">{repoName}</span>
            {branchName && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                {branchName}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="text-sm text-zinc-400 hover:text-white"
        >
          Settings
        </Link>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-medium">
          {initial}
        </div>
        <button
          onClick={() => void signOut()}
          className="text-sm text-zinc-400 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
