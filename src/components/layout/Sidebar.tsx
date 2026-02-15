"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/Skeleton";

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded px-3 py-2 text-sm ${
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function TeamRepos({ teamId }: { teamId: Id<"teams"> }) {
  const repos = useQuery(api.projects.listByTeam, { teamId });
  const pathname = usePathname();

  if (!repos || repos.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5 pl-3">
      {repos.map((repo) => {
        const repoHref = `/workspace/${repo._id}`;
        const isActive = pathname.startsWith(repoHref);
        return (
          <Link
            key={repo._id}
            href={repoHref}
            className={`block rounded px-3 py-1.5 text-xs ${
              isActive
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            }`}
          >
            {repo.githubOwner}/{repo.githubRepo}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const teams = useQuery(api.teams.listMyTeams);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          <NavItem href="/home" label="Home" active={pathname === "/home"} />
          <NavItem
            href="/settings"
            label="Settings"
            active={pathname === "/settings"}
          />
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-xs font-medium tracking-wider text-zinc-500 uppercase">
              Teams
            </span>
            <Link
              href="/home"
              className="text-zinc-500 hover:text-white"
              title="Create team"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
              </svg>
            </Link>
          </div>

          {teams === undefined ? (
            <div className="space-y-3 px-3">
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-3 h-4 w-28" />
                <Skeleton className="ml-3 h-4 w-32" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="ml-3 h-4 w-30" />
              </div>
            </div>
          ) : teams.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600">No teams yet</div>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => {
                const teamHref = `/team/${team._id}`;
                const isTeamActive = pathname.startsWith(teamHref);
                return (
                  <div key={team._id}>
                    <Link
                      href={teamHref}
                      className={`block rounded px-3 py-2 text-sm font-medium ${
                        isTeamActive
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
                      }`}
                    >
                      {team.name}
                    </Link>
                    <div className="mt-0.5 space-y-0.5 pl-3">
                      <Link
                        href={`/team/${team._id}/llm-settings`}
                        className={`block rounded px-3 py-1.5 text-xs ${
                          pathname === `/team/${team._id}/llm-settings`
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
                        }`}
                      >
                        LLM Settings
                      </Link>
                    </div>
                    <TeamRepos teamId={team._id} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
