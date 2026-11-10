'use client'

import type { Post } from '@/models/post'
import { usePostLike } from '@/hooks/use-post-like'
import { usePostStats } from '@/hooks/use-post-stats'
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
  const live = usePostStats(post.id)
  const { count: likes } = usePostLike(post)
  return (
    <PostStats
      withIcons
      words={words}
      minutes={minutes}
      views={live?.viewCount ?? post.viewCount ?? 0}
      likes={likes}
      comments={live?.commentCount ?? post.commentCount ?? 0}
      className={className}
    />
  )
}
