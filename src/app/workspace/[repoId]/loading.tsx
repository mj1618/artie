import { Skeleton } from "@/components/ui/Skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="flex h-screen bg-paper-100">
      {/* Chat panel skeleton */}
      <div className="flex w-[400px] flex-col border-r border-paper-300">
        <div className="border-b border-paper-300 p-3">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <div className="flex-1 space-y-4 p-4">
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
          <Skeleton className="h-20 w-3/4 rounded-lg" />
        </div>
        <div className="border-t border-paper-300 p-3">
          <Skeleton className="h-20 w-full rounded-md" />
        </div>
      </div>
      {/* Preview panel skeleton */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-paper-300 px-3 py-2">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 flex-1 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Skeleton className="mx-auto h-12 w-12 rounded-full" />
            <Skeleton className="mx-auto mt-4 h-4 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
