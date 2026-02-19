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
      className={`block rounded-md px-3 py-2 text-sm font-medium transition-all ${
        active
          ? "bg-paper-50 text-paper-900 shadow-paper-sm ring-1 ring-paper-300"
          : "text-paper-600 hover:bg-paper-50/80 hover:text-paper-900"
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
            className={`block rounded-md px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? "bg-paper-50 text-paper-800 ring-1 ring-paper-300"
                : "text-paper-500 hover:bg-paper-50/60 hover:text-paper-700"
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-paper-300 bg-paper-200/80">
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          <NavItem href="/home" label="Home" active={pathname === "/home"} />
          <NavItem
            href="/settings"
            label="Settings"
            active={pathname === "/settings"}
          />
          <NavItem
            href="/pull-requests"
            label="Pull Requests"
            active={pathname.startsWith("/pull-requests")}
          />
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-xs font-semibold tracking-wider text-paper-500 uppercase">
              Teams
            </span>
            <Link
              href="/home"
              className="rounded p-0.5 text-paper-500 transition-colors hover:bg-paper-300 hover:text-paper-800"
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
            <div className="px-3 py-2 text-xs text-paper-500">No teams yet</div>
          ) : (
            <div className="space-y-3">
              {teams.map((team) => {
                const teamHref = `/team/${team._id}`;
                const isTeamActive = pathname.startsWith(teamHref);
                return (
                  <div key={team._id}>
                    <Link
                      href={teamHref}
                      className={`block rounded-md px-3 py-2 text-sm font-medium transition-all ${
                        isTeamActive
                          ? "bg-paper-50 text-paper-900 shadow-paper-sm ring-1 ring-paper-300"
                          : "text-paper-600 hover:bg-paper-50/80 hover:text-paper-900"
                      }`}
                    >
                      {team.name}
                    </Link>
                    <div className="mt-1 space-y-0.5 pl-3">
                      <Link
                        href={`/team/${team._id}/llm-settings`}
                        className={`block rounded-md px-3 py-1.5 text-xs transition-colors ${
                          pathname === `/team/${team._id}/llm-settings`
                            ? "bg-paper-50 text-paper-800 ring-1 ring-paper-300"
                            : "text-paper-500 hover:bg-paper-50/60 hover:text-paper-700"
                        }`}
                      >
                        LLM Settings
                      </Link>
                      <Link
                        href={`/team/${team._id}/deploy-keys`}
                        className={`block rounded-md px-3 py-1.5 text-xs transition-colors ${
                          pathname === `/team/${team._id}/deploy-keys`
                            ? "bg-paper-50 text-paper-800 ring-1 ring-paper-300"
                            : "text-paper-500 hover:bg-paper-50/60 hover:text-paper-700"
                        }`}
                      >
                        Deploy Keys
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
