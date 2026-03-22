import { Skeleton } from '@/components/ui/skeleton'
import { contentAreaPaddingClass } from '@/utils/common/layout-size'

const HEADER_SKELETON_ITEMS = Array.from({ length: 6 })
const COMMENTS_SKELETON_ITEMS = Array.from({ length: 3 })
const SIDEBAR_SKELETON_ITEMS = Array.from({ length: 3 })

export default function Loading() {
  return (
    <div className="flex flex-col h-100vh">
      {/* Header Skeleton */}
      <div className="relative h-96 bg-gradient-to-b from-primary/20 to-background">
        <div className={`${contentAreaPaddingClass} h-full flex flex-col justify-end pb-8`}>
          <Skeleton className="h-12 w-3/4 mb-4" />
          <div className="flex flex-wrap gap-3">
            {HEADER_SKELETON_ITEMS.map((_, i) => (
              <Skeleton key={i} className="h-5 w-24" />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 py-4">
        {/* Content Area Skeleton */}
        <div className="lg:col-span-3">
          <div className="bg-background border rounded-xl p-4 md:p-8">
            {/* Description Skeleton */}
            <div className="mb-8 bg-primary/10 rounded-xl p-4">
              <Skeleton className="h-6 w-32 mb-2" />
              <Skeleton className="h-4 w-full mt-2" />
              <Skeleton className="h-4 w-5/6 mt-2" />
            </div>

            {/* Article Content Skeleton */}
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-full mt-6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>

          {/* Comments Section Skeleton */}
          <div className={`bg-background mt-4 rounded-xl border ${contentAreaPaddingClass} py-4 md:py-8`}>
            <Skeleton className="h-8 w-48 mb-6" />
            {COMMENTS_SKELETON_ITEMS.map((_, i) => (
              <div key={i} className="flex gap-3 mb-6">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Skeleton */}
        <div className="space-y-4">
          {SIDEBAR_SKELETON_ITEMS.map((_, i) => (
            <div key={i} className="bg-background border rounded-xl p-4">
              <Skeleton className="h-6 w-32 mb-3" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
