'use client'
import type { Post } from '@/models/post'
import type { User } from '@/models/user'
import { HeartIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getLikedUsers, toggleLike } from '@/api/like'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/contexts/auth-context'
import { useToLogin } from '@/hooks/use-route'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { TargetType } from '@/models/types'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName, getFirstCharFromUser } from '@/utils/common/username'

const MAX_LIKED_USERS = 5

export function BlogLikeButton({ post }: { post: Post }) {
  const commonT = useCommonT()
  const operationT = useOperationT()
  const { user } = useAuth()
  const clickToLogin = useToLogin()
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

    getLikedUsers({ targetType: TargetType.Post, targetId: post.id, number: 5 })
      .then((res) => {
        setLikedUsers(res.data.users?.slice(0, MAX_LIKED_USERS) || [])
      })
      .catch(() => {
        setLikedUsers([])
      })
  }, [shouldFetchLikedUsers, likedUsersVersion, post.id])

  const handleToggleLike = () => {
    if (!canClickLike) {
      return
    }
    setCanClickLike(false)
    if (!user) {
      toast.error(commonT('login_required'), {
        action: {
          label: operationT('login'),
          onClick: () => {
            setCanClickLike(true)
            clickToLogin()
          },
        },
        onDismiss: () => {
          setCanClickLike(true)
        },
      })
      return
    }
    // 提前转换状态，让用户觉得响应很快，失败时回滚
    const likedPrev = liked
    const likeCountPrev = likeCount
    setLiked(!likedPrev)
    setLikeCount(likeCountPrev + (likedPrev ? -1 : 1))
    toggleLike({ targetType: TargetType.Post, targetId: post.id })
      .then((res) => {
        toast.success(res.data.status ? operationT('like_success') : operationT('unlike_success'))
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

  return (
    <div ref={likeButtonRef} className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={handleToggleLike}
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
        <HeartIcon aria-hidden className={cn('size-5', liked && 'fill-current')} />
        <span className="tabular-nums">{likeCount}</span>
      </button>
      <div className="text-sm text-foreground/50">
        {operationT('n_users_liked', { n: likeCount })}
      </div>
      {likedUsers.length > 0 && (
        <div className="flex justify-center gap-2">
          {likedUsers.map(u => (
            <Link
              key={u.id}
              href={getUserUrl(u)}
              aria-label={formatDisplayName(u)}
              title={formatDisplayName(u)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="size-8 rounded-full">
                <AvatarImage
                  className="rounded-full"
                  src={getAvatarOrGravatarUrlFromUser({ user: u })}
                  alt={u.nickname}
                />
                <AvatarFallback className="rounded-full">{getFirstCharFromUser(u)}</AvatarFallback>
              </Avatar>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
