import type { Post } from '@/models/post'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useOperationT } from '@/hooks/use-translations'
import { getPostUrl } from '@/utils/common/route'
// iframe 草稿预览器
export function PostPreviewDialogWithButton({
  post,
  onPreview,
}: {
  post: Post
  onPreview: () => Promise<unknown> | void
}) {
  const operationT = useOperationT()
  // 等草稿保存完成后再加载 iframe，避免预览到保存前的旧草稿
  const [ready, setReady] = useState(false)
  const handlePreview = () => {
    setReady(false)
    Promise.resolve(onPreview()).finally(() => setReady(true))
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={handlePreview}>
          {operationT('preview')}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] !max-w-none h-[90vh] p-0 border-0">
        <DialogTitle className="sr-only">{operationT('preview')}</DialogTitle>
        {ready
          ? (
              <iframe
                src={getPostUrl({ post, type: 'draft' })}
                className="w-full h-full border-2 rounded-lg"
              />
            )
          : <Skeleton className="w-full h-full rounded-lg" />}
      </DialogContent>
    </Dialog>
  )
}
