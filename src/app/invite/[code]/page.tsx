"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import { useState } from "react";

export default function InvitePage() {
  const params = useParams();
  const code = params.code as string;
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const invite = useQuery(api.teams.getInviteByCode, { code });
  const acceptInvite = useMutation(api.teams.acceptInviteLink);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loading state
  if (invite === undefined || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg">
          <div className="flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-paper-400 border-t-paper-700" />
          </div>
          <p className="mt-4 text-center text-sm text-paper-500">
            Loading invite...
          </p>
        </div>
      </div>
    );
  }

  // Invalid or not found
  if (invite === null || !invite.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-paper-900">
            This invite link is no longer valid
          </h1>
          <p className="mt-2 text-sm text-paper-500">
            {invite?.expired
              ? "This invite link has expired."
              : invite?.maxedOut
                ? "This invite link has reached its maximum uses."
                : "The invite link could not be found."}
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-paper-50 hover:bg-primary-hover"
          >
            Go to homepage
          </Link>
        </div>
      </div>
    );
  }

  // Valid + logged in + already a member
  if (isAuthenticated && invite.isMember) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-paper-900">
            You&apos;re already a member of {invite.teamName}!
          </h1>
          <Link
            href="/home"
            className="mt-6 inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-paper-50 hover:bg-primary-hover"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Valid + not logged in
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-100">
        <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg text-center">
          <h1 className="text-xl font-semibold text-paper-900">
            You&apos;ve been invited to join {invite.teamName}!
          </h1>
          <p className="mt-2 text-sm text-paper-500">
            Sign up or sign in to accept this invite.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href={`/signup?redirect=/invite/${code}`}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-paper-50 hover:bg-primary-hover"
            >
              Sign up to join
            </Link>
            <Link
              href={`/login?redirect=/invite/${code}`}
              className="rounded border border-paper-400 px-4 py-2 text-sm font-medium text-paper-700 hover:bg-paper-300"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Valid + logged in + not a member
  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      await acceptInvite({ code });
      router.push("/home");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to join team",
      );
      setJoining(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100">
      <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg text-center">
        <h1 className="text-xl font-semibold text-paper-900">
          Join {invite.teamName}
        </h1>
        <p className="mt-2 text-sm text-paper-500">
          You&apos;ve been invited to join this team.
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        <button
          onClick={handleJoin}
          disabled={joining}
          className="mt-6 w-full rounded bg-primary px-4 py-2 text-sm font-medium text-paper-50 hover:bg-primary-hover disabled:opacity-50"
        >
          {joining ? "Joining..." : "Join team"}
        </button>
      </div>
    </div>
  );
}
