import {
  PageHeaderSkeleton,
  CardSkeleton,
} from "@/components/ui/DashboardSkeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeaderSkeleton />
      <div className="mt-8 space-y-6">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    </div>
  );
}
