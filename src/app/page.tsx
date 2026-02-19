"use client";

import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm4.03 6.28a.75.75 0 0 0-1.06-1.06L4.97 9.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06-1.06L6.56 10l1.72-1.72Zm3.44-1.06a.75.75 0 1 1 1.06 1.06L11.06 10l1.72 1.72a.75.75 0 1 1-1.06 1.06l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25Z" clipRule="evenodd" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M1 4.75C1 3.784 1.784 3 2.75 3h14.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 17.25 10H2.75A1.75 1.75 0 0 1 1 8.25v-3.5Zm0 7C1 10.784 1.784 10 2.75 10h14.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 17.25 17H2.75A1.75 1.75 0 0 1 1 15.25v-3.5ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 12.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-4.158a.75.75 0 1 1 1.08-1.04l5.25 5.5a.75.75 0 0 1 0 1.04l-5.25 5.5a.75.75 0 1 1-1.08-1.04l3.96-4.158H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
    </svg>
  );
}

function MockWorkspacePreview() {
  return (
    <div className="mx-auto mt-16 max-w-4xl px-6">
      <div className="overflow-hidden rounded-xl border border-paper-300 bg-paper-50 shadow-lg">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-paper-300 bg-paper-200 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-paper-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-paper-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-paper-400" />
          </div>
          <div className="ml-2 flex-1 rounded bg-paper-300 px-3 py-1 text-xs text-paper-500">
            composure.dev/workspace/my-app
          </div>
        </div>
        {/* Content area */}
        <div className="flex h-64 md:h-72">
          {/* Chat panel */}
          <div className="flex w-2/5 flex-col border-r border-paper-300 p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-paper-300" />
              <div className="h-3 w-24 rounded bg-paper-300" />
            </div>
            <div className="mb-2 ml-8 rounded-lg bg-paper-200 px-3 py-2">
              <div className="h-2.5 w-full rounded bg-paper-300" />
              <div className="mt-1.5 h-2.5 w-3/4 rounded bg-paper-300" />
            </div>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-paper-700" />
              <div className="h-3 w-12 rounded bg-paper-400" />
            </div>
            <div className="ml-8 rounded-lg bg-paper-700/10 px-3 py-2">
              <div className="h-2.5 w-full rounded bg-paper-400/50" />
              <div className="mt-1.5 h-2.5 w-2/3 rounded bg-paper-400/50" />
              <div className="mt-1.5 h-2.5 w-4/5 rounded bg-paper-400/50" />
            </div>
            <div className="mt-auto rounded-lg border border-paper-300 bg-paper-100 px-3 py-2">
              <div className="h-2.5 w-2/3 rounded bg-paper-300" />
            </div>
          </div>
          {/* Preview panel */}
          <div className="flex w-3/5 flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-2">
                <div className="h-6 w-16 rounded bg-paper-300" />
                <div className="h-6 w-16 rounded bg-paper-200" />
              </div>
              <div className="h-6 w-6 rounded bg-paper-200" />
            </div>
            <div className="flex-1 rounded-lg border border-paper-300 bg-white p-4">
              <div className="mb-3 h-4 w-1/3 rounded bg-paper-300" />
              <div className="mb-2 h-2.5 w-full rounded bg-paper-200" />
              <div className="mb-2 h-2.5 w-5/6 rounded bg-paper-200" />
              <div className="mb-4 h-2.5 w-2/3 rounded bg-paper-200" />
              <div className="flex gap-2">
                <div className="h-8 w-20 rounded bg-paper-700" />
                <div className="h-8 w-20 rounded border border-paper-300 bg-paper-100" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    icon: SparklesIcon,
    title: "AI-Powered Editing",
    description: "Describe changes in plain English. Composure's AI understands your intent and writes the code for you.",
  },
  {
    icon: EyeIcon,
    title: "Live Preview",
    description: "See your changes instantly in a real browser preview. No waiting for builds or deployments.",
  },
  {
    icon: CodeIcon,
    title: "GitHub Integration",
    description: "Changes sync directly to your repository. Review diffs, create branches, and push when ready.",
  },
  {
    icon: UsersIcon,
    title: "Team Collaboration",
    description: "Invite team members to collaborate on projects. Non-technical users can contribute without coding.",
  },
  {
    icon: CheckCircleIcon,
    title: "PR Review Workflow",
    description: "Review AI-generated changes before merging. Approve, request edits, or iterate until it's right.",
  },
  {
    icon: ServerIcon,
    title: "Multiple Runtimes",
    description: "Support for Next.js, React, and more. Your projects run in real environments with full fidelity.",
  },
];

const steps = [
  {
    number: "1",
    title: "Connect your repo",
    description: "Link a GitHub repository to Composure. We clone it and set up a live dev environment automatically.",
  },
  {
    number: "2",
    title: "Describe changes",
    description: "Tell Composure what you want in plain English. Change a headline, add a section, fix a layout — anything.",
  },
  {
    number: "3",
    title: "See results",
    description: "Watch your changes appear in a live preview. When you're happy, push to GitHub with one click.",
  },
];

const techStack = [
  { name: "Next.js" },
  { name: "Convex" },
  { name: "GitHub" },
  { name: "Anthropic" },
];

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
      <div className="flex h-screen items-center justify-center bg-paper-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-400 border-t-paper-700" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper-100 text-paper-900">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12">
        <span className="text-xl font-bold tracking-tight">Composure</span>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-paper-600 hover:text-paper-950"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-paper-50 hover:bg-primary-hover"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-20 text-center md:pt-28">
        <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:text-6xl">
          Edit your app with words,{" "}
          <span className="bg-gradient-to-r from-paper-700 to-paper-500 bg-clip-text text-transparent">
            not code
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-paper-600">
          Composure lets anyone on your team modify web applications using plain
          English. Describe what you want, see it live, and ship to GitHub — no
          coding required.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-sm font-semibold text-paper-50 shadow-md transition-colors hover:bg-primary-hover"
          >
            Get started free
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-paper-400 px-7 py-3.5 text-sm font-medium text-paper-700 transition-colors hover:border-paper-500 hover:bg-paper-200 hover:text-paper-950"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Mock workspace preview */}
      <MockWorkspacePreview />

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 pt-28 pb-20">
        <h2 className="mb-4 text-center text-2xl font-bold tracking-tight md:text-3xl">
          How it works
        </h2>
        <p className="mx-auto mb-14 max-w-lg text-center text-paper-600">
          Go from idea to deployed change in three simple steps.
        </p>
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-paper-700 text-sm font-bold text-paper-50">
                {step.number}
              </div>
              <h3 className="mb-2 text-sm font-semibold text-paper-900">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-paper-600">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-4 text-center text-2xl font-bold tracking-tight md:text-3xl">
          Everything you need
        </h2>
        <p className="mx-auto mb-14 max-w-lg text-center text-paper-600">
          A complete platform for teams that want to move fast without writing code.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-paper-300 bg-paper-200 p-6 shadow-sm"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-paper-300 text-paper-700">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-paper-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-paper-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack / trust */}
      <section className="border-t border-paper-300 py-16">
        <p className="mb-6 text-center text-xs font-medium tracking-widest text-paper-500 uppercase">
          Built with
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {techStack.map((tech) => (
            <span
              key={tech.name}
              className="rounded-full border border-paper-300 bg-paper-200 px-4 py-1.5 text-xs font-medium text-paper-600"
            >
              {tech.name}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-paper-300 px-6 py-10 md:px-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 md:flex-row">
          <span className="text-sm font-bold tracking-tight text-paper-700">Composure</span>
          <div className="flex items-center gap-6">
            <Link href="/login" className="text-sm text-paper-500 hover:text-paper-800">
              Sign in
            </Link>
            <Link href="/signup" className="text-sm text-paper-500 hover:text-paper-800">
              Sign up
            </Link>
          </div>
          <p className="text-xs text-paper-400">
            &copy; {new Date().getFullYear()} Composure. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
