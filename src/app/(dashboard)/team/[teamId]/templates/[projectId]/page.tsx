"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../../convex/_generated/api";
import { Id } from "../../../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

function StatusBadge({ status }: { status: "provisioning" | "active" | "error" }) {
  const colors = {
    active: "bg-green-500/20 text-green-400",
    provisioning: "bg-yellow-500/20 text-yellow-400",
    error: "bg-red-500/20 text-red-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status]}`}
    >
      {status}
    </span>
  );
}

export default function TemplateProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const teamId = params.teamId as Id<"teams">;
  const projectId = params.projectId as Id<"templateProjects">;

  const project = useQuery(api.templates.get, { projectId });
  const team = useQuery(api.teams.getTeam, { teamId });
  const me = useQuery(api.users.currentUser);
  const removeProject = useMutation(api.templates.remove);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (project === undefined || team === undefined || me === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-paper-400 border-t-white" />
        </div>
      </div>
    );
  }

  if (!project || !team) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href={`/team/${teamId}`}
          className="text-sm text-paper-600 hover:text-paper-800"
        >
          &larr; Back to Team
        </Link>
        <div className="mt-6 rounded-lg border border-paper-300 bg-paper-200 p-8 text-center">
          <p className="text-sm text-paper-600">
            Project not found or you don&apos;t have access.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = team.ownerId === me?._id;

  async function handleDelete() {
    setDeleting(true);
    try {
      await removeProject({ projectId });
      toast({ type: "success", message: "Project deleted" });
      router.push(`/team/${teamId}`);
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete project",
      });
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/team/${teamId}`}
        className="text-sm text-paper-600 hover:text-paper-800"
      >
        &larr; Back to Team
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-paper-900">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>

      {/* Project Information */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-paper-800">
          Project Information
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
          <dl className="divide-y divide-paper-300">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Name</dt>
              <dd className="text-sm font-medium text-paper-800">
                {project.name}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Slug</dt>
              <dd className="font-mono text-sm text-paper-800">
                {project.slug}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Template</dt>
              <dd className="text-sm text-paper-800">Next.js + Convex</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Created</dt>
              <dd className="text-sm text-paper-800">
                {new Date(project.createdAt).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-paper-600">Status</dt>
              <dd>
                <StatusBadge status={project.status} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Deployment Details */}
      {(project.convexProjectId || project.convexDeploymentUrl || project.flyioAppName) && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-paper-800">
            Deployment Details
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
            <dl className="divide-y divide-paper-300">
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-sm text-paper-600">Convex Project ID</dt>
                <dd className="text-sm text-paper-800">
                  {project.convexProjectId || (
                    <span className="text-paper-500">Pending...</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-sm text-paper-600">Convex Deployment URL</dt>
                <dd className="text-sm">
                  {project.convexDeploymentUrl ? (
                    <a
                      href={project.convexDeploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {project.convexDeploymentUrl}
                    </a>
                  ) : (
                    <span className="text-paper-500">Pending...</span>
                  )}
                </dd>
              </div>
              {project.flyioAppName && (
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-sm text-paper-600">Fly.io App Name</dt>
                  <dd className="font-mono text-sm text-paper-800">
                    {project.flyioAppName}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Error Section */}
      {project.status === "error" && project.errorMessage && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-red-400">Error</h2>
          <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3">
            <p className="text-sm text-red-300">{project.errorMessage}</p>
          </div>
        </div>
      )}

      {/* Danger Zone - owner only */}
      {isOwner && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-red-900/50 bg-paper-200">
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-medium text-paper-800">
                  Delete Project
                </p>
                <p className="mt-0.5 text-xs text-paper-500">
                  Permanently delete this template project. This cannot be
                  undone.
                </p>
              </div>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-900/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Project?"
        description={`Are you sure you want to delete "${project.name}"? This will permanently remove the project and all associated data.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
