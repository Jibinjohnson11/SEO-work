import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading campaigns">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="surface flex h-60 flex-col overflow-hidden">
              <div className="flex justify-between gap-2 border-b px-4 py-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-14" />
              </div>
              <div className="grid flex-1 grid-cols-2 gap-3 px-4 py-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
                <Skeleton className="col-span-2 h-8 w-full" />
              </div>
              <div className="flex justify-between border-t px-3 py-2.5">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
