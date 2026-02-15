import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6">
      <h1 className="text-7xl font-bold text-white">404</h1>
      <p className="mt-4 text-lg text-zinc-400">Page not found</p>
      <div className="mt-8 flex items-center gap-4">
        <Link
          href="/"
          className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          Go home
        </Link>
        <Link
          href="/home"
          className="text-sm text-zinc-400 hover:text-white"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
