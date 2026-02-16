"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function SignupPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/home");
    }
  }, [isAuthenticated, router]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  function getInputBorderClass(fieldName: string): string {
    if (!touched[fieldName]) return "border-zinc-700 focus:border-zinc-500";

    if (fieldName === "password") {
      if (password.length === 0) return "border-zinc-700 focus:border-zinc-500";
      return password.length >= 8
        ? "border-green-600 focus:border-green-500"
        : "border-red-500 focus:border-red-400";
    }

    if (fieldName === "confirmPassword") {
      if (confirmPassword.length === 0) return "border-zinc-700 focus:border-zinc-500";
      return password === confirmPassword
        ? "border-green-600 focus:border-green-500"
        : "border-red-500 focus:border-red-400";
    }

    return "border-zinc-700 focus:border-zinc-500";
  }

  const isValid =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await signIn("password", { email, password, name, flow: "signUp" });
    } catch {
      setError("Could not create account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-8">
      <h1 className="mb-6 text-center text-2xl font-semibold text-zinc-100">
        Create your account
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            placeholder="Jane Doe"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            required
            autoComplete="new-password"
            className={`rounded border ${getInputBorderClass("password")} bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none`}
            placeholder="••••••••"
          />
          {touched.password && password.length > 0 && password.length < 8 && (
            <span className="text-xs text-red-400">Password must be at least 8 characters</span>
          )}
          {touched.password && password.length >= 8 && (
            <span className="text-xs text-green-400">Password looks good</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-400">Confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
            required
            autoComplete="new-password"
            className={`rounded border ${getInputBorderClass("confirmPassword")} bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none`}
            placeholder="••••••••"
          />
          {touched.confirmPassword && confirmPassword.length > 0 && password !== confirmPassword && (
            <span className="text-xs text-red-400">Passwords do not match</span>
          )}
          {touched.confirmPassword && confirmPassword.length > 0 && password === confirmPassword && (
            <span className="text-xs text-green-400">Passwords match</span>
          )}
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !isValid}
          className="rounded bg-zinc-100 py-2 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="text-zinc-100 underline hover:text-white">
          Sign in
        </Link>
      </p>
    </div>
  );
}
