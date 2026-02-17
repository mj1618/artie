import {
  PageHeaderSkeleton,
  ListItemSkeleton,
} from "@/components/ui/DashboardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeaderSkeleton />
      <div className="mt-8 space-y-8">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-paper-300 bg-paper-200"
          >
            <div className="flex items-center justify-between border-b border-paper-300 px-4 py-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="divide-y divide-paper-300">
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
