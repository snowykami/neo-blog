'use client'

import type { Post } from '@/models/post'
import { Loader2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getRandomPost } from '@/api/post'
import { SafeImage } from '@/components/common/safe-image'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { useOperationT } from '@/hooks/use-translations'
import { getPostUrl } from '@/utils/common/route'

export function RandomPost() {
  const t = useTranslations('Random')
  const operationT = useOperationT()
  const router = useRouter()
  const [post, setPost] = useState<Post | null>(null)
  useEffect(() => {
    getRandomPost()
      .then((res) => {
        setPost(res.data)
        // 等待 300 ms 再跳转，避免闪烁
        setTimeout(() => {
          router.push(getPostUrl({ post: res.data }))
        }, 300)
      })
      .catch((err) => {
        toast.error(err.message || operationT('fetch_failed'))
      })
  }, [])

  return (
    <SiteShell className="max-w-[48rem]">
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-6 rounded-2xl bg-card px-6 py-10"
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2Icon aria-hidden className="size-10 animate-spin text-primary" />

        <div className="text-center">
          <p className="text-lg font-medium text-foreground/90">
            {post ? t('coming_soon') : t('jumping_to_post')}
          </p>
          {!post && <p className="mt-1 text-sm text-foreground/50">{t('selecting_post')}</p>}
        </div>

        {post ? <RandomPostPreview post={post} /> : <RandomPostPreviewSkeleton />}
      </div>
    </SiteShell>
  )
}

function RandomPostPreview({ post }: { post: Post }) {
  const format = useFormatter()
  return (
    <div className="grid w-full gap-4">
      {post.cover && (
        <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
          <SafeImage src={post.cover} alt="" fill sizes="768px" className="object-cover" />
        </div>
      )}
      <div className="grid gap-2">
        <h2 className="text-2xl font-bold text-foreground/90">{post.title}</h2>
        <p className="text-sm text-foreground/50 tabular-nums">
          {format.dateTime(new Date(post.createdAt), { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </p>
        {post.description && <p className="text-foreground/75">{post.description}</p>}
      </div>
    </div>
  )
}

function RandomPostPreviewSkeleton() {
  return (
    <div className="grid w-full gap-4">
      <Skeleton className="aspect-[2/1] w-full rounded-xl" />
      <div className="grid gap-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  )
}
