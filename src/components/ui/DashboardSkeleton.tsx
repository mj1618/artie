import { Skeleton } from "@/components/ui/Skeleton";

export function PageHeaderSkeleton() {
  return (
    <div>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <Skeleton className="h-5 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: `${80 - i * 10}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-16 rounded-md" />
    </div>
  );
}
