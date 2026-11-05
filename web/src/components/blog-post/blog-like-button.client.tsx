'use client'
import type { Post } from '@/models/post'
import type { User } from '@/models/user'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getLikedUsers, toggleLike } from '@/api/like'
import { useRequireLogin } from '@/components/auth/login-dialog'
import { UserAvatar } from '@/components/common/avatar'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { LikeIcon } from '@/contexts/theme-context'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { TargetType } from '@/models/types'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'

const MAX_LIKED_USERS = 5

export function BlogLikeButton({ post }: { post: Post }) {
  const operationT = useOperationT()
  const requireLogin = useRequireLogin()
  const [liked, setLiked] = useState(post.isLiked)
  const [likeCount, setLikeCount] = useState(post.likeCount || 0)
  const [likedUsers, setLikedUsers] = useState<User[]>([])
  const [canClickLike, setCanClickLike] = useState(true)
  const [shouldFetchLikedUsers, setShouldFetchLikedUsers] = useState(false)
  // 点赞结果被服务端确认后自增，触发点赞用户列表刷新（不能依赖乐观状态，否则会在服务端更新前拉取）
  const [likedUsersVersion, setLikedUsersVersion] = useState(0)
  const likeButtonRef = useRef<HTMLDivElement>(null)

  // Lazy load liked users only when in viewport
  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (!shouldFetchLikedUsers)
      return

    getLikedUsers({ targetType: TargetType.Post, targetId: post.id, number: MAX_LIKED_USERS })
      .then((res) => {
        setLikedUsers(res.data.users?.slice(0, MAX_LIKED_USERS) || [])
      })
      .catch(() => {
        setLikedUsers([])
      })
  }, [shouldFetchLikedUsers, likedUsersVersion, post.id])

  // 未登录时由 requireLogin 弹出快捷登录，登录后接着执行，因此这里不再判断登录状态
  const like = () => {
    if (!canClickLike) {
      return
    }
    setCanClickLike(false)
    // 提前转换状态，让用户觉得响应很快，失败时回滚
    const likedPrev = liked
    const likeCountPrev = likeCount
    setLiked(!likedPrev)
    setLikeCount(likeCountPrev + (likedPrev ? -1 : 1))
    // 传入期望状态：快捷登录后页面上的点赞状态可能已过期，避免把已赞的点成取消
    toggleLike({ targetType: TargetType.Post, targetId: post.id, liked: !likedPrev })
      .then((res) => {
        // 点赞时岛上的爱心（节日主题下为节日图形）随主题变化；取消点赞只给一句确认
        if (res.data.status)
          notifySuccess(operationT('like_success'), { key: 'like', icon: <LikeIcon aria-hidden className="fill-current text-rose-400" /> })
        else
          notifySuccess(operationT('unlike_success'), { key: 'unlike' })
        // 以服务端结果为准，校正乐观状态
        setLiked(res.data.status)
        setLikeCount(likeCountPrev + (res.data.status === likedPrev ? 0 : res.data.status ? 1 : -1))
        setLikedUsersVersion(v => v + 1)
      })
      .catch((error) => {
        toast.error(`${operationT('like_failed')}: ${error.message}`)
        setLiked(likedPrev)
        setLikeCount(likeCountPrev)
      })
      .finally(() => {
        setCanClickLike(true)
      })
  }

  // 未展示头像的点赞人数
  const moreLikedCount = Math.max(0, likeCount - likedUsers.length)

  return (
    <div ref={likeButtonRef} className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => requireLogin(like, 'like')}
        aria-label={liked ? operationT('unlike') : operationT('like')}
        aria-pressed={liked}
        title={liked ? operationT('unlike') : operationT('like')}
        className={cn(
          'inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-5 font-medium select-none transition-[color,background-color,transform] duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          liked
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-secondary text-secondary-foreground hover:bg-primary/15',
        )}
      >
        <LikeIcon className={cn('size-5', liked && 'fill-current')} />
        <span className="tabular-nums">{likeCount}</span>
      </button>
      <div className="text-sm text-foreground/50">
        {operationT('n_users_liked', { n: likeCount })}
      </div>
      {/* 最近点赞的人在前，头像互相压住一点；超出的人数用末尾的「+N」表示 */}
      {likedUsers.length > 0 && (
        <div className="flex justify-center -space-x-2">
          {likedUsers.map(u => (
            <Link
              key={u.id}
              href={getUserUrl(u)}
              aria-label={formatDisplayName(u)}
              title={formatDisplayName(u)}
              className="relative rounded-full ring-2 ring-card transition-transform duration-150 hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-ring"
            >
              <UserAvatar user={u} size={64} className="size-8" />
            </Link>
          ))}
          {moreLikedCount > 0 && (
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
