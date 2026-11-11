import type { PageModel } from '@/models/page'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useOperationT } from '@/hooks/use-translations'
import { getPagePreviewUrl } from '@/utils/common/route'

// iframe 草稿预览器：加载后台的页面预览页（按前台页面的样子渲染草稿，私密页面同样可看），不走前台路由（与文章的预览器一致）
export function PagePreviewDialog({
  page,
  open,
  onOpenChange,
  onBeforePreview,
}: {
  page: PageModel
  open: boolean
  onOpenChange: (open: boolean) => void
  // 打开时先保存草稿
  onBeforePreview: () => Promise<unknown> | void
}) {
  const operationT = useOperationT()
  // 等草稿保存完成后再加载 iframe，避免预览到保存前的旧草稿
  const [ready, setReady] = useState(false)
  const beforeRef = useRef(onBeforePreview)
  beforeRef.current = onBeforePreview
  useEffect(() => {
    if (!open)
      return
    let cancelled = false
    Promise.resolve(beforeRef.current()).finally(() => {
      if (!cancelled)
        setReady(true)
    })
    return () => {
      cancelled = true
      setReady(false)
    }
  }, [open, beforeRef])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] w-[90vw] !max-w-none overflow-hidden rounded-2xl border-0 p-0">
        <DialogTitle className="sr-only">{operationT('preview')}</DialogTitle>
        {ready
          ? <iframe src={getPagePreviewUrl(page)} className="size-full" />
          : <Skeleton className="size-full rounded-2xl" />}
      </DialogContent>
    </Dialog>
  )
}
