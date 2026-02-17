"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useToast } from "@/lib/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function DeployKeysPage() {
  const params = useParams();
  const teamId = params.teamId as Id<"teams">;
  const team = useQuery(api.teams.getTeam, { teamId });
  const keys = useQuery(api.deployKeys.listByTeam, { teamId });
  const addDeployKey = useMutation(api.deployKeys.addDeployKey);
  const deleteDeployKey = useMutation(api.deployKeys.deleteDeployKey);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: Id<"flyioDeployKeys">;
    name: string;
  } | null>(null);
  const { toast } = useToast();

  if (team === undefined || keys === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-paper-400 border-t-paper-950" />
        </div>
      </div>
    );
  }

  if (team === null) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/home"
          className="text-sm text-paper-600 hover:text-paper-800"
        >
          &larr; Back to dashboard
        </Link>
        <div className="mt-6 rounded-lg border border-paper-300 bg-paper-200 p-8 text-center">
          <p className="text-sm text-paper-600">
            Not authorized. Only team owners can manage deploy keys.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = team.myRole === "owner";

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href={`/team/${teamId}`}
          className="text-sm text-paper-600 hover:text-paper-800"
        >
          &larr; Back to team
        </Link>
        <div className="mt-6 rounded-lg border border-paper-300 bg-paper-200 p-8 text-center">
          <p className="text-sm text-paper-600">
            Only team owners can manage deploy keys.
          </p>
        </div>
      </div>
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedKey = key.trim();
    if (!trimmedName || !trimmedKey) return;
    setAdding(true);
    try {
      await addDeployKey({ teamId, name: trimmedName, key: trimmedKey });
      setName("");
      setKey("");
      toast({ type: "success", message: "Deploy key added" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to add key",
      });
    } finally {
      setAdding(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.id);
    try {
      await deleteDeployKey({ keyId: confirmDelete.id });
      toast({ type: "success", message: "Deploy key deleted" });
      setConfirmDelete(null);
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete key",
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/team/${teamId}`}
        className="text-sm text-paper-600 hover:text-paper-800"
      >
        &larr; Back to team
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-paper-900">
        Fly.io Deploy Keys
      </h1>
      <p className="mt-1 text-sm text-paper-500">
        Manage deploy keys for server-side runtime environments.
      </p>

      {/* Existing Keys */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-paper-800">Deploy Keys</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
          {keys.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-paper-500">
              No deploy keys added yet. Add a Fly.io deploy key to enable
              server-side runtime for your projects.
            </div>
          ) : (
            <ul className="divide-y divide-paper-300">
              {keys.map((k) => (
                <li
                  key={k._id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-paper-800">
                      {k.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-paper-500">
                      <span>
                        Added{" "}
                        {new Date(k.createdAt).toLocaleDateString()}
                      </span>
                      {k.lastUsedAt && (
                        <span>
                          Last used{" "}
                          {new Date(k.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setConfirmDelete({ id: k._id, name: k.name })
                    }
                    disabled={deleting === k._id}
                    className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
                  >
                    {deleting === k._id ? "Deleting..." : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Add Key Form */}
      <form onSubmit={handleAdd} className="mt-8">
        <h2 className="text-lg font-semibold text-paper-800">Add Deploy Key</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-paper-300 bg-paper-200">
          <div className="space-y-4 p-4">
            <div>
              <label
                htmlFor="keyName"
                className="block text-sm font-medium text-paper-700"
              >
                Key Name
              </label>
              <input
                id="keyName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production deploy key"
                className="mt-2 w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
              />
            </div>
            <div>
              <label
                htmlFor="deployKey"
                className="block text-sm font-medium text-paper-700"
              >
                Deploy Key
              </label>
              <input
                id="deployKey"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your Fly.io deploy token"
                className="mt-2 w-full rounded-md border border-paper-400 bg-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
              />
              <p className="mt-1 text-xs text-paper-500">
                Your deploy key is stored securely and never exposed to the
                browser.
              </p>
            </div>
          </div>
          <div className="border-t border-paper-300 px-4 py-3">
            <button
              type="submit"
              disabled={adding || !name.trim() || !key.trim()}
              className="rounded-md bg-paper-700 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-300 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Key"}
            </button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete deploy key"
        description={`Are you sure you want to delete "${confirmDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting !== null}
      />
    </div>
  );
}
