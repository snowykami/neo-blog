import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** 登录 / 注册卡片的占位：表单要读查询参数，预渲染的页面里先放同样大小的骨架，浏览器里再换成表单 */
export function AuthCardSkeleton() {
  return (
    <Card>
      <CardHeader className="items-center">
        <Skeleton className="mx-auto h-7 w-32" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  )
}
