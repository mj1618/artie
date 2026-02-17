import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-100 px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-paper-400">404</p>
        <h1 className="mt-4 text-xl font-semibold text-paper-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-paper-600">
          The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
        </p>
        <Link
          href="/home"
          className="mt-6 inline-block rounded-md bg-paper-300 px-4 py-2 text-sm font-medium text-paper-800 hover:bg-paper-400"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
