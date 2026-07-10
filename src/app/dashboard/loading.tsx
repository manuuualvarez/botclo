import { Skeleton } from "@/components/ui/skeleton";

// Skeleton instantáneo mientras el servidor consulta Binance/DB: la
// navegación se siente inmediata aunque los datos tarden.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <Skeleton className="h-36 sm:col-span-2" />
        <div className="grid gap-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
