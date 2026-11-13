'use client'

import type { ComponentProps } from 'react'
import type { CommentSection } from './index'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

// 评论区离视口还有这么远时开始加载（约一屏半）：滚到时通常已经就绪
const PRELOAD_MARGIN = '1200px 0px'
const COMMENT_SKELETON_ITEMS = Array.from({ length: 2 })

function CommentsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="mb-6 h-8 w-48" />
      {COMMENT_SKELETON_ITEMS.map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

const LazyCommentSection = dynamic(() => import('./index').then(m => m.CommentSection), {
  ssr: false,
  loading: () => <CommentsSkeleton />,
})

/** 地址里带着要定位的评论（通知深链 ?comment=、#comment-xx 锚点）：不等滚动，直接加载 */
function wantsCommentsNow() {
  return new URLSearchParams(window.location.search).has('comment') || window.location.hash.startsWith('#comment')
}

/**
 * 文章页的评论区：评论列表、输入框、@提及与附件的代码（约 40 KB）不进首屏包，评论区接近视口时才加载并请求评论；
 * 之前显示与加载中相同的骨架，占位高度不变
 */
export function DeferredCommentSection(props: ComponentProps<typeof CommentSection>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (wantsCommentsNow()) {
      setVisible(true)
      return
    }
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: PRELOAD_MARGIN })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref}>
      {visible ? <LazyCommentSection {...props} /> : <CommentsSkeleton />}
    </div>
  )
}
