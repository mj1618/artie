"use client";

import { useState, useEffect } from "react";
import { useParams, notFound, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  PageHeaderSkeleton,
  CardSkeleton,
  ListItemSkeleton,
} from "@/components/ui/DashboardSkeleton";
import { Tabs, TabList, Tab, TabPanels, TabPanel } from "@/components/ui/Tabs";

// Icons
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z" clipRule="evenodd" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
      <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
    </svg>
  );
}

function EnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5V7A2.5 2.5 0 0 0 11 4.5H8.128a2.252 2.252 0 0 1 1.884-1.488A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clipRule="evenodd" />
      <path fillRule="evenodd" d="M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8 7a5 5 0 1 1 3.61 4.804l-1.903 1.903A1 1 0 0 1 9 14H8v1a1 1 0 0 1-1 1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 .293-.707L8.196 8.39A5.002 5.002 0 0 1 8 7Zm5-3a.75.75 0 0 0 0 1.5A1.5 1.5 0 0 1 14.5 7 .75.75 0 0 0 16 7a3 3 0 0 0-3-3Z" clipRule="evenodd" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
    </svg>
  );
}

// Team Header with stats
function TeamHeader({
  team,
  memberCount,
  repoCount,
  pendingInviteCount,
  isOwner,
}: {
  team: { name: string };
  memberCount: number;
  repoCount: number;
  pendingInviteCount: number;
  isOwner: boolean;
}) {
  return (
    <div className="mb-6">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 text-sm text-paper-500 hover:text-paper-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
        </svg>
        Back to dashboard
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-white shadow-paper">
            <UsersIcon className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-paper-900">{team.name}</h1>
            <div className="mt-1 flex items-center gap-3">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isOwner
                  ? "bg-amber-100 text-amber-700"
                  : "bg-paper-200 text-paper-600"
              }`}>
                {isOwner ? "Owner" : "Member"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-paper-200 bg-paper-50 px-4 py-3 shadow-paper-sm">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-paper-400" />
            <span className="text-xs font-medium text-paper-500">Members</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-paper-900">{memberCount}</p>
        </div>
        <div className="rounded-lg border border-paper-200 bg-paper-50 px-4 py-3 shadow-paper-sm">
          <div className="flex items-center gap-2">
            <FolderIcon className="h-4 w-4 text-paper-400" />
            <span className="text-xs font-medium text-paper-500">Repositories</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-paper-900">{repoCount}</p>
        </div>
        <div className="rounded-lg border border-paper-200 bg-paper-50 px-4 py-3 shadow-paper-sm">
          <div className="flex items-center gap-2">
            <EnvelopeIcon className="h-4 w-4 text-paper-400" />
            <span className="text-xs font-medium text-paper-500">Pending Invites</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-paper-900">{pendingInviteCount}</p>
        </div>
      </div>
    </div>
  );
}

// Members List Component
function MembersList({
  teamId,
  isOwner,
}: {
  teamId: Id<"teams">;
  isOwner: boolean;
}) {
  const members = useQuery(api.teams.listMembers, { teamId });
  const removeMember = useMutation(api.teams.removeMember);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmMember, setConfirmMember] = useState<{
    id: Id<"teamMembers">;
    name: string;
  } | null>(null);
  const { toast } = useToast();

  if (members === undefined) {
    return (
      <div className="divide-y divide-paper-200">
        <ListItemSkeleton />
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    );
  }

  async function handleConfirmRemove() {
    if (!confirmMember) return;
    setRemoving(confirmMember.id);
    try {
      await removeMember({ teamId, memberId: confirmMember.id });
      toast({ type: "success", message: "Member removed" });
      setConfirmMember(null);
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to remove member",
      });
    } finally {
      setRemoving(null);
    }
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <UsersIcon className="h-12 w-12 text-paper-300" />
        <h3 className="mt-3 text-sm font-medium text-paper-700">No members yet</h3>
        <p className="mt-1 text-sm text-paper-500">Invite people to join your team</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-paper-200">
        {members.map((member) => (
          <li
            key={member._id}
            className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-paper-100/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-paper-200 text-paper-600">
                <span className="text-sm font-medium">
                  {(member.name ?? member.email ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-paper-800">
                  {member.name ?? member.email ?? "Unknown user"}
                </p>
                {member.name && member.email && (
                  <p className="truncate text-xs text-paper-500">{member.email}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  member.role === "owner"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-paper-200 text-paper-600"
                }`}
              >
                {member.role}
              </span>
              {isOwner && member.role !== "owner" && (
                <button
                  onClick={() =>
                    setConfirmMember({
                      id: member._id,
                      name: member.name ?? member.email ?? "this member",
                    })
                  }
                  disabled={removing === member._id}
                  className="rounded-md p-1.5 text-paper-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  title="Remove member"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmMember !== null}
        onClose={() => setConfirmMember(null)}
        onConfirm={handleConfirmRemove}
        title="Remove member"
        description={`Are you sure you want to remove ${confirmMember?.name} from this team?`}
        confirmLabel="Remove"
        variant="danger"
        loading={removing !== null}
      />
    </>
  );
}

// Unified Invite Section
function InviteSection({ teamId }: { teamId: Id<"teams"> }) {
  const [inviteMethod, setInviteMethod] = useState<"link" | "email">("link");

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-paper-800">Invite New Members</h3>
        <div className="flex rounded-lg border border-paper-300 bg-paper-100 p-0.5">
          <button
            onClick={() => setInviteMethod("link")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              inviteMethod === "link"
                ? "bg-white text-paper-900 shadow-sm"
                : "text-paper-500 hover:text-paper-700"
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            Link
          </button>
          <button
            onClick={() => setInviteMethod("email")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              inviteMethod === "email"
                ? "bg-white text-paper-900 shadow-sm"
                : "text-paper-500 hover:text-paper-700"
            }`}
          >
            <EnvelopeIcon className="h-3.5 w-3.5" />
            Email
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
        {inviteMethod === "link" ? (
          <InviteLinkForm teamId={teamId} />
        ) : (
          <EmailInviteForm teamId={teamId} />
        )}
      </div>
    </div>
  );
}

function InviteLinkForm({ teamId }: { teamId: Id<"teams"> }) {
  const inviteLinks = useQuery(api.teams.listInviteLinks, { teamId });
  const createInviteLink = useMutation(api.teams.createInviteLink);
  const deleteInviteLink = useMutation(api.teams.deleteInviteLink);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function handleGenerate() {
    setGenerating(true);
    try {
      const code = await createInviteLink({ teamId });
      toast({ type: "success", message: "Invite link created" });
      try {
        await navigator.clipboard.writeText(`${appUrl}/invite/${code}`);
        setCopied(code);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        // clipboard may not be available
      }
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create link",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(`${appUrl}/invite/${code}`);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
      toast({ type: "success", message: "Link copied to clipboard" });
    } catch {
      toast({ type: "error", message: "Failed to copy link" });
    }
  }

  async function handleDelete(inviteLinkId: Id<"inviteLinks">) {
    setDeleting(inviteLinkId);
    try {
      await deleteInviteLink({ inviteLinkId });
      toast({ type: "success", message: "Invite link deleted" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete link",
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="p-4">
        <p className="text-sm text-paper-600">
          Generate a shareable link that anyone can use to join your team.
        </p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-paper-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          {generating ? "Generating..." : "Generate Link"}
        </button>
      </div>

      {inviteLinks && inviteLinks.length > 0 && (
        <ul className="divide-y divide-paper-200 border-t border-paper-200">
          {inviteLinks.map((link) => (
            <li
              key={link._id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-paper-700">
                  {appUrl}/invite/{link.code}
                </p>
                <p className="mt-0.5 text-xs text-paper-500">
                  Used {link.useCount} time{link.useCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="ml-3 flex items-center gap-2">
                <button
                  onClick={() => handleCopy(link.code)}
                  className="rounded-md p-2 text-paper-500 transition-colors hover:bg-paper-200 hover:text-paper-700"
                  title="Copy link"
                >
                  {copied === link.code ? (
                    <CheckIcon className="h-4 w-4 text-sage" />
                  ) : (
                    <ClipboardIcon className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(link._id)}
                  disabled={deleting === link._id}
                  className="rounded-md p-2 text-paper-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  title="Delete link"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailInviteForm({ teamId }: { teamId: Id<"teams"> }) {
  const invites = useQuery(api.teams.listInvites, { teamId });
  const inviteMember = useMutation(api.teams.inviteMember);
  const cancelInvite = useMutation(api.teams.cancelInvite);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setError(null);
    try {
      await inviteMember({ teamId, email: trimmed });
      setEmail("");
      toast({ type: "success", message: `Invite sent to ${trimmed}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite";
      setError(msg);
      toast({ type: "error", message: msg });
    } finally {
      setInviting(false);
    }
  }

  async function handleCancel(inviteId: Id<"invites">) {
    setCancelling(inviteId);
    try {
      await cancelInvite({ inviteId });
      toast({ type: "success", message: "Invite cancelled" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to cancel invite",
      });
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div>
      <form onSubmit={handleInvite} className="p-4">
        <p className="text-sm text-paper-600">
          Send an email invite directly to someone&apos;s inbox.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="flex-1 rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-paper-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <EnvelopeIcon className="h-4 w-4" />
            {inviting ? "Sending..." : "Send Invite"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </form>

      {invites && invites.length > 0 && (
        <ul className="divide-y divide-paper-200 border-t border-paper-200">
          {invites.map((invite) => (
            <li
              key={invite._id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky/10">
                  <EnvelopeIcon className="h-4 w-4 text-sky" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-paper-700">{invite.email}</p>
                  <p className="text-xs text-paper-500">Pending invite</p>
                </div>
              </div>
              <button
                onClick={() => handleCancel(invite._id)}
                disabled={cancelling === invite._id}
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-paper-500 transition-colors hover:bg-paper-200 hover:text-paper-700 disabled:opacity-50"
              >
                {cancelling === invite._id ? "Cancelling..." : "Cancel"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Repository List Component
function RepoList({
  teamId,
  isOwner,
}: {
  teamId: Id<"teams">;
  isOwner: boolean;
}) {
  const repos = useQuery(api.projects.listByTeam, { teamId });
  const removeRepo = useMutation(api.projects.removeRepo);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRepo, setConfirmRepo] = useState<{
    id: Id<"repos">;
    name: string;
  } | null>(null);
  const { toast } = useToast();

  if (repos === undefined) {
    return (
      <div className="divide-y divide-paper-200">
        <ListItemSkeleton />
        <ListItemSkeleton />
      </div>
    );
  }

  async function handleConfirmRemove() {
    if (!confirmRepo) return;
    setRemoving(confirmRepo.id);
    try {
      await removeRepo({ repoId: confirmRepo.id });
      toast({ type: "success", message: "Repository removed" });
      setConfirmRepo(null);
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to remove repository",
      });
    } finally {
      setRemoving(null);
    }
  }

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderIcon className="h-12 w-12 text-paper-300" />
        <h3 className="mt-3 text-sm font-medium text-paper-700">No repositories connected</h3>
        <p className="mt-1 text-sm text-paper-500">Connect a GitHub repository to get started</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-paper-200">
        {repos.map((repo) => (
          <li
            key={repo._id}
            className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-paper-100/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-paper-200">
                <FolderIcon className="h-5 w-5 text-paper-500" />
              </div>
              <div className="min-w-0">
                <Link
                  href={`/workspace/${repo._id}`}
                  className="text-sm font-medium text-paper-800 hover:text-primary transition-colors"
                >
                  {repo.githubOwner}/{repo.githubRepo}
                </Link>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="rounded bg-paper-200 px-1.5 py-0.5 font-mono text-xs text-paper-500">
                    {repo.defaultBranch}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      repo.pushStrategy === "direct"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-sky/10 text-sky"
                    }`}
                  >
                    {repo.pushStrategy === "direct" ? "Direct push" : "Pull request"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/repos/${repo._id}/settings`}
                className="rounded-md p-2 text-paper-400 transition-colors hover:bg-paper-200 hover:text-paper-700"
                title="Repository settings"
              >
                <CogIcon className="h-4 w-4" />
              </Link>
              {isOwner && (
                <button
                  onClick={() =>
                    setConfirmRepo({
                      id: repo._id,
                      name: `${repo.githubOwner}/${repo.githubRepo}`,
                    })
                  }
                  disabled={removing === repo._id}
                  className="rounded-md p-2 text-paper-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  title="Remove repository"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmRepo !== null}
        onClose={() => setConfirmRepo(null)}
        onConfirm={handleConfirmRemove}
        title="Remove repository"
        description={`Are you sure you want to remove ${confirmRepo?.name} from this team?`}
        confirmLabel="Remove"
        variant="danger"
        loading={removing !== null}
      />
    </>
  );
}

// Add Repo Form
function AddRepoForm({ teamId, onClose }: { teamId: Id<"teams">; onClose?: () => void }) {
  const addRepo = useMutation(api.projects.addRepo);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [pushStrategy, setPushStrategy] = useState<"direct" | "pr">("pr");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const owner = githubOwner.trim();
    const repo = githubRepo.trim();
    if (!owner || !repo) return;
    setAdding(true);
    setError(null);
    try {
      await addRepo({
        teamId,
        githubOwner: owner,
        githubRepo: repo,
        defaultBranch: defaultBranch.trim() || "main",
        pushStrategy,
      });
      toast({ type: "success", message: `Connected ${owner}/${repo}` });
      setGithubOwner("");
      setGithubRepo("");
      setDefaultBranch("main");
      setPushStrategy("pr");
      onClose?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect repository",
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-paper-700">
          Repository
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={githubOwner}
            onChange={(e) => setGithubOwner(e.target.value)}
            placeholder="owner"
            className="flex-1 rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="text-paper-400">/</span>
          <input
            type="text"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="repository"
            className="flex-1 rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-paper-700">
            Default Branch
          </label>
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="main"
            className="w-full rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-paper-700">
            Push Strategy
          </label>
          <select
            value={pushStrategy}
            onChange={(e) => setPushStrategy(e.target.value as "direct" | "pr")}
            className="w-full rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="pr">Create Pull Request</option>
            <option value="direct">Direct to branch</option>
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-paper-600 transition-colors hover:text-paper-900"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={adding || !githubOwner.trim() || !githubRepo.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-paper-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {adding ? "Connecting..." : "Connect Repository"}
        </button>
      </div>
    </form>
  );
}

// GitHub Repo Browser
interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
}

function RepoBrowser({
  teamId,
  existingRepos,
  onClose,
}: {
  teamId: Id<"teams">;
  existingRepos: Array<{ githubOwner: string; githubRepo: string }>;
  onClose: () => void;
}) {
  const listRepos = useAction(api.github.listUserRepos);
  const addRepo = useMutation(api.projects.addRepo);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<
    Record<string, "direct" | "pr">
  >({});
  const { toast } = useToast();

  useEffect(() => {
    listRepos({})
      .then(setRepos)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load repos"),
      )
      .finally(() => setLoading(false));
  }, [listRepos]);

  const filtered = repos?.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  const isConnected = (owner: string, name: string) =>
    existingRepos.some(
      (r) => r.githubOwner === owner && r.githubRepo === name,
    );

  async function handleConnect(repo: GithubRepo) {
    const key = `${repo.owner}/${repo.name}`;
    setConnecting(key);
    try {
      await addRepo({
        teamId,
        githubOwner: repo.owner,
        githubRepo: repo.name,
        defaultBranch: repo.defaultBranch,
        pushStrategy: selectedStrategy[key] ?? "pr",
      });
      toast({ type: "success", message: `Connected ${key}` });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to connect",
      });
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-paper-800">
          Your GitHub Repositories
        </h3>
        <button
          onClick={onClose}
          className="text-xs font-medium text-paper-500 transition-colors hover:text-paper-700"
        >
          Close
        </button>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search repos..."
        className="mb-4 w-full rounded-md border border-paper-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-300 border-t-primary" />
          <span className="ml-2 text-sm text-paper-500">Loading repos from GitHub...</span>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {filtered && (
        <ul className="max-h-80 divide-y divide-paper-200 overflow-y-auto rounded-lg border border-paper-200">
          {filtered.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const connected = isConnected(repo.owner, repo.name);
            return (
              <li
                key={key}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-paper-100/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-paper-800">
                    {repo.fullName}
                  </p>
                  {repo.description && (
                    <p className="mt-0.5 truncate text-xs text-paper-500">
                      {repo.description}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-paper-500">
                    <span className="rounded bg-paper-200 px-1.5 py-0.5 font-mono">
                      {repo.defaultBranch}
                    </span>
                    {repo.private && (
                      <span className="text-amber-600">Private</span>
                    )}
                  </div>
                </div>
                {connected ? (
                  <span className="ml-3 flex items-center gap-1 text-xs font-medium text-sage">
                    <CheckIcon className="h-4 w-4" />
                    Connected
                  </span>
                ) : (
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <select
                      value={selectedStrategy[key] ?? "pr"}
                      onChange={(e) =>
                        setSelectedStrategy((s) => ({
                          ...s,
                          [key]: e.target.value as "direct" | "pr",
                        }))
                      }
                      className="rounded-md border border-paper-300 bg-white px-2 py-1.5 text-xs text-paper-700 outline-none focus:border-primary"
                    >
                      <option value="pr">PR</option>
                      <option value="direct">Direct</option>
                    </select>
                    <button
                      onClick={() => handleConnect(repo)}
                      disabled={connecting === key}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-paper-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      {connecting === key ? "..." : "Connect"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-paper-500">
              No repos match your search
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function AddRepoSection({ teamId }: { teamId: Id<"teams"> }) {
  const profile = useQuery(api.users.getProfile);
  const existingRepos = useQuery(api.projects.listByTeam, { teamId });
  const [showBrowser, setShowBrowser] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const hasGithub = !!profile?.githubUsername;

  if (hasGithub && showBrowser) {
    return (
      <div className="mt-4 rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
        <RepoBrowser
          teamId={teamId}
          existingRepos={existingRepos ?? []}
          onClose={() => setShowBrowser(false)}
        />
      </div>
    );
  }

  if (showManual) {
    return (
      <div className="mt-4 rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
        <AddRepoForm teamId={teamId} onClose={() => setShowManual(false)} />
      </div>
    );
  }

  return (
    <div className="mt-4">
      {hasGithub ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowBrowser(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-paper-sm transition-colors hover:bg-primary-hover"
          >
            <PlusIcon className="h-4 w-4" />
            Browse GitHub Repos
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-paper-500 transition-colors hover:text-paper-700"
          >
            or enter manually
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-paper-300 bg-paper-50 px-4 py-6 text-center">
          <FolderIcon className="mx-auto h-10 w-10 text-paper-300" />
          <p className="mt-2 text-sm text-paper-600">
            <Link
              href="/settings"
              className="font-medium text-primary transition-colors hover:text-primary-hover"
            >
              Connect your GitHub account
            </Link>{" "}
            to browse repos, or{" "}
            <button
              onClick={() => setShowManual(true)}
              className="font-medium text-primary transition-colors hover:text-primary-hover"
            >
              enter manually
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

// Settings Tab Components
function SettingsTab({ teamId }: { teamId: Id<"teams"> }) {
  const llmSettings = useQuery(api.teams.getLlmSettings, { teamId });
  const deployKeys = useQuery(api.deployKeys.listByTeam, { teamId });

  return (
    <div className="space-y-4">
      {/* LLM Settings Card */}
      <div className="rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
        <div className="flex items-center justify-between border-b border-paper-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-plum/10">
              <SparklesIcon className="h-5 w-5 text-plum" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-paper-800">LLM Settings</h3>
              <p className="text-xs text-paper-500">Configure your AI provider</p>
            </div>
          </div>
          <Link
            href={`/team/${teamId}/llm-settings`}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Configure
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="px-4 py-3">
          {llmSettings === undefined ? (
            <div className="h-4 w-32 animate-pulse rounded bg-paper-200" />
          ) : llmSettings?.llmProvider ? (
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-paper-500">Provider</p>
                <p className="text-sm font-medium text-paper-800 capitalize">
                  {llmSettings.llmProvider}
                </p>
              </div>
              {llmSettings.llmModel && (
                <div>
                  <p className="text-xs text-paper-500">Model</p>
                  <p className="text-sm font-medium text-paper-800">
                    {llmSettings.llmModel}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-paper-500">API Key</p>
                <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                  llmSettings.hasApiKey ? "text-sage" : "text-amber-600"
                }`}>
                  {llmSettings.hasApiKey ? (
                    <>
                      <CheckIcon className="h-3.5 w-3.5" />
                      Configured
                    </>
                  ) : (
                    "Not set"
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-paper-500">Using platform defaults</p>
          )}
        </div>
      </div>

      {/* Deploy Keys Card */}
      <div className="rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
        <div className="flex items-center justify-between border-b border-paper-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky/10">
              <KeyIcon className="h-5 w-5 text-sky" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-paper-800">Deploy Keys</h3>
              <p className="text-xs text-paper-500">Fly.io deployment credentials</p>
            </div>
          </div>
          <Link
            href={`/team/${teamId}/deploy-keys`}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Manage
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="px-4 py-3">
          {deployKeys === undefined ? (
            <div className="h-4 w-24 animate-pulse rounded bg-paper-200" />
          ) : (
            <p className="text-sm text-paper-700">
              <span className="font-semibold">{deployKeys.length}</span>{" "}
              {deployKeys.length === 1 ? "key" : "keys"} configured
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Page Component
export default function TeamManagementPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamId = params.teamId as Id<"teams">;

  const team = useQuery(api.teams.getTeam, { teamId });
  const members = useQuery(api.teams.listMembers, { teamId });
  const repos = useQuery(api.projects.listByTeam, { teamId });
  const invites = useQuery(api.teams.listInvites, { teamId });
  const inviteLinks = useQuery(api.teams.listInviteLinks, { teamId });

  const initialTab = searchParams.get("tab") ?? "members";

  function handleTabChange(tab: string) {
    router.replace(`/team/${teamId}?tab=${tab}`, { scroll: false });
  }

  if (team === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeaderSkeleton />
        <div className="mt-8 space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    );
  }

  if (team === null) notFound();

  const isOwner = team.myRole === "owner";
  const memberCount = members?.length ?? 0;
  const repoCount = repos?.length ?? 0;
  const pendingInviteCount = (invites?.length ?? 0) + (inviteLinks?.length ?? 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <TeamHeader
        team={team}
        memberCount={memberCount}
        repoCount={repoCount}
        pendingInviteCount={pendingInviteCount}
        isOwner={isOwner}
      />

      <Tabs defaultTab={initialTab} onChange={handleTabChange}>
        <TabList>
          <Tab value="members" icon={<UsersIcon className="h-4 w-4" />}>
            Members
          </Tab>
          <Tab value="repos" icon={<FolderIcon className="h-4 w-4" />}>
            Repositories
          </Tab>
          {isOwner && (
            <Tab value="settings" icon={<CogIcon className="h-4 w-4" />}>
              Settings
            </Tab>
          )}
        </TabList>

        <TabPanels className="mt-6">
          <TabPanel value="members">
            <div className="rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
              <MembersList teamId={teamId} isOwner={isOwner} />
            </div>
            {isOwner && <InviteSection teamId={teamId} />}
          </TabPanel>

          <TabPanel value="repos">
            <div className="rounded-lg border border-paper-200 bg-paper-50 shadow-paper-sm">
              <RepoList teamId={teamId} isOwner={isOwner} />
            </div>
            {isOwner && <AddRepoSection teamId={teamId} />}
          </TabPanel>

          {isOwner && (
            <TabPanel value="settings">
              <SettingsTab teamId={teamId} />
            </TabPanel>
          )}
        </TabPanels>
      </Tabs>
    </div>
  );
}
