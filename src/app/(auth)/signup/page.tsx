"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

function SignupForm() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isAuthenticated) {
      router.push(redirect || "/home");
    }
  }, [isAuthenticated, router, redirect]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  function getInputBorderClass(fieldName: string): string {
    if (!touched[fieldName]) return "border-paper-400 focus:border-paper-500";

    if (fieldName === "password") {
      if (password.length === 0) return "border-paper-400 focus:border-paper-500";
      return password.length >= 8
        ? "border-green-600 focus:border-green-500"
        : "border-red-500 focus:border-red-400";
    }

    if (fieldName === "confirmPassword") {
      if (confirmPassword.length === 0) return "border-paper-400 focus:border-paper-500";
      return password === confirmPassword
        ? "border-green-600 focus:border-green-500"
        : "border-red-500 focus:border-red-400";
    }

    return "border-paper-400 focus:border-paper-500";
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
    <div className="w-full max-w-sm rounded-lg border border-paper-300 bg-paper-200 p-8 shadow-lg">
      <h1 className="mb-6 text-center text-2xl font-semibold text-paper-900">
        Create your account
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-paper-600">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border border-paper-400 bg-paper-100 px-3 py-2 text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
            placeholder="Jane Doe"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-paper-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded border border-paper-400 bg-paper-100 px-3 py-2 text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500"
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-paper-600">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            required
            autoComplete="new-password"
            className={`rounded border ${getInputBorderClass("password")} bg-paper-100 px-3 py-2 text-paper-900 placeholder-paper-500 outline-none`}
            placeholder="••••••••"
          />
          {touched.password && password.length > 0 && password.length < 8 && (
            <span className="text-xs text-red-600">Password must be at least 8 characters</span>
          )}
          {touched.password && password.length >= 8 && (
            <span className="text-xs text-green-600">Password looks good</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-paper-600">Confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
            required
            autoComplete="new-password"
            className={`rounded border ${getInputBorderClass("confirmPassword")} bg-paper-100 px-3 py-2 text-paper-900 placeholder-paper-500 outline-none`}
            placeholder="••••••••"
          />
          {touched.confirmPassword && confirmPassword.length > 0 && password !== confirmPassword && (
            <span className="text-xs text-red-600">Passwords do not match</span>
          )}
          {touched.confirmPassword && confirmPassword.length > 0 && password === confirmPassword && (
            <span className="text-xs text-green-600">Passwords match</span>
          )}
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !isValid}
          className="rounded bg-primary py-2 font-medium text-paper-50 hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-paper-600">
        Already have an account?{" "}
        <Link href={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"} className="text-paper-800 underline hover:text-paper-950">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
