'use client'

import type { Post } from '@/models/post'
import { useSiteInfo } from '@/contexts/site-info-context'
import { usePostLike } from '@/hooks/use-post-like'
import { usePostStats } from '@/hooks/use-post-stats'
import { isCommentEnabled, isLikeEnabled } from '@/utils/common/siteinfo'
import { PostStats } from './post-meta'

/**
 * 文章页的字数 / 阅读时长 / 浏览量 / 点赞数 / 评论数：页面按 ISR 缓存，服务端渲染的计数是快照，
 * 挂载后换成浏览器另取的最新值（见 hooks/use-post-stats.ts）；点赞数与点赞按钮、灵动岛共用一份，本页点赞后同步变化
 */
export function PostLiveStats({
  post,
  words,
  minutes,
  className,
}: {
  post: Pick<Post, 'id' | 'isLiked' | 'likeCount' | 'viewCount' | 'commentCount'>
  words: number
  minutes: number
  className?: string
}) {
  const { siteInfo } = useSiteInfo()
  const likeEnabled = isLikeEnabled(siteInfo)
  const commentEnabled = isCommentEnabled(siteInfo)
  const live = usePostStats(post.id)
  const { count: likes } = usePostLike(post)
  return (
    <PostStats
      withIcons
      words={words}
      minutes={minutes}
      views={live?.viewCount ?? post.viewCount ?? 0}
      likes={likeEnabled ? likes : undefined}
      comments={commentEnabled ? (live?.commentCount ?? post.commentCount ?? 0) : undefined}
      className={className}
    />
  )
}
