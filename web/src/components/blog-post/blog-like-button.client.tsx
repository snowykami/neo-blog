'use client'
import type { Post } from '@/models/post'
import type { UserAvatarInfo } from '@/models/user'
import { useEffect, useRef, useState } from 'react'
import { getLikedUsers } from '@/api/like'
import { UserAvatar } from '@/components/common/avatar'
import { useSiteInfo } from '@/contexts/site-info-context'
import { LikeIcon } from '@/contexts/theme-context'
import { usePostLike } from '@/hooks/use-post-like'
import { useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { TargetType } from '@/models/types'
import { getUserUrl } from '@/utils/common/route'
import { isLikeEnabled } from '@/utils/common/siteinfo'
import { formatDisplayName } from '@/utils/common/username'

const MAX_LIKED_USERS = 5

export function BlogLikeButton({ post }: { post: Pick<Post, 'id' | 'isLiked' | 'likeCount'> }) {
  const { siteInfo } = useSiteInfo()
  const likeEnabled = isLikeEnabled(siteInfo)
  const operationT = useOperationT()
  // 与顶栏灵动岛的「读完啦」提示共用点赞状态（见 hooks/use-post-like.tsx）：在岛上点赞后这里同步变化
  const { liked, count: likeCount, version: likedUsersVersion, toggle } = usePostLike(post)
  const [likedUsers, setLikedUsers] = useState<UserAvatarInfo[]>([])
  const [shouldFetchLikedUsers, setShouldFetchLikedUsers] = useState(false)
  const likeButtonRef = useRef<HTMLDivElement>(null)

  // Lazy load liked users only when in viewport
  useEffect(() => {
    if (!likeEnabled)
      return
    const element = likeButtonRef.current
    if (!element)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShouldFetchLikedUsers(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [likeEnabled])

  useEffect(() => {
    if (!likeEnabled || !shouldFetchLikedUsers)
      return

    getLikedUsers({ targetType: TargetType.Post, targetId: post.id, number: MAX_LIKED_USERS })
      .then((res) => {
        setLikedUsers(res.data.users?.slice(0, MAX_LIKED_USERS) || [])
      })
      .catch(() => {
        setLikedUsers([])
      })
  }, [likeEnabled, shouldFetchLikedUsers, likedUsersVersion, post.id])

  if (!likeEnabled)
    return null

  // 未展示头像的点赞人数
  const moreLikedCount = Math.max(0, likeCount - likedUsers.length)

  return (
    <div ref={likeButtonRef} className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        // 状态由 aria-pressed 表达，名称保持「点赞」不随状态变化
        aria-label={operationT('like')}
        aria-pressed={liked}
        title={liked ? operationT('unlike') : operationT('like')}
        className={cn(
          'group inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-5 font-medium select-none transition-[color,background-color,transform] duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          liked
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-secondary text-secondary-foreground hover:bg-primary/15',
        )}
      >
        <LikeIcon className={cn('size-5 transition-transform duration-150 active:scale-90 group-active:scale-90', liked && 'fill-current')} />
        <span className="tabular-nums">{likeCount}</span>
      </button>
      <div className="text-sm text-muted-foreground">
        {operationT('n_users_liked', { n: likeCount })}
      </div>
      {/* 最近点赞的人在前，头像只压住一点点（手机上不重叠、留出间距，避免点错人）；超出的人数用末尾的「+N」表示；likeCount > 0 时预留 min-h-8 消除异步加载 CLS */}
      {(likeCount > 0 || likedUsers.length > 0) && (
        <div className="flex min-h-8 justify-center gap-1.5 sm:-space-x-1 sm:gap-0">
          {likedUsers.map(u => (
            <Link
              key={u.id}
              href={getUserUrl(u, 'posts')}
              prefetch={false}
              aria-label={formatDisplayName(u)}
              title={formatDisplayName(u)}
              className="relative rounded-full ring-2 ring-card transition-transform duration-150 hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserAvatar user={u} size={64} className="size-8" />
            </Link>
          ))}
          {likedUsers.length > 0 && moreLikedCount > 0 && (
            <span
              title={operationT('n_more_users_liked', { n: moreLikedCount })}
              aria-label={operationT('n_more_users_liked', { n: moreLikedCount })}
              className="relative inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums text-secondary-foreground ring-2 ring-card"
            >
              {moreLikedCount > 99 ? '99+' : `+${moreLikedCount}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
