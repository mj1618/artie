"use client";

import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LandingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/home");
    }
  }, [isAuthenticated, router]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12">
        <span className="text-xl font-bold tracking-tight">Artie</span>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-zinc-400 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center md:pt-32 md:pb-28">
        <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:text-6xl">
          Build with AI,{" "}
          <span className="bg-gradient-to-r from-zinc-200 to-zinc-500 bg-clip-text text-transparent">
            preview instantly
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">
          Artie lets non-technical users modify web applications using plain
          English. Describe what you want, see the result in a live preview, and
          push changes to GitHub — no code required.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className="rounded-md bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">
              AI-Powered Editing
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Describe changes in plain English. Artie&apos;s AI understands
              your intent and writes the code for you.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path
                  fillRule="evenodd"
                  d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Live Preview
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              See your changes instantly in a real browser preview. No waiting
              for builds or deployments.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">
              GitHub Integration
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Changes sync directly to your repository. Review diffs, create
              branches, and push when you&apos;re ready.
            </p>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-zinc-800 py-16 text-center">
        <p className="text-sm text-zinc-500">
          Ready to get started?{" "}
          <Link
            href="/signup"
            className="text-zinc-100 underline hover:text-white"
          >
            Create an account
          </Link>{" "}
          or{" "}
          <Link
            href="/login"
            className="text-zinc-100 underline hover:text-white"
          >
            sign in
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
