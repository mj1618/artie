import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-zinc-700">404</p>
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
        </p>
        <Link
          href="/home"
          className="mt-6 inline-block rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
