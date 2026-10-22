import type { Comment } from '@/models/comment'
import { Ellipsis, Heart, Lock, Reply } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createComment,
  deleteComment,
  getComment,
  listComments,
  updateComment,
} from '@/api/comment'
import { toggleLike } from '@/api/like'
import { UserAvatar } from '@/components/common/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useDoubleConfirm } from '@/hooks/use-double-confirm'
import { useToLogin } from '@/hooks/use-route'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { TargetType } from '@/models/types'
import { formatDateTime } from '@/utils/common/datetime'
import { getErrorMessage } from '@/utils/common/error'
import { formatLocation } from '@/utils/common/location'
import { isAdmin } from '@/utils/common/permission'
import { getUserUrl } from '@/utils/common/route'
import { CommentInput } from './comment-input'

export function CommentItem({
  comment,
  ownerId,
  parentComment,
  onCommentDelete,
  activeInput,
  setActiveInputId,
  onReplySubmitted, // 评论区计数更新用
}: {
  comment: Comment
  ownerId?: number // 不是评论的作者ID，而是文章的作者ID
  parentComment: Comment | null
  onCommentDelete: ({ commentId }: { commentId: number }) => void
  activeInput: { id: number, type: 'reply' | 'edit' } | null
  setActiveInputId: (input: { id: number, type: 'reply' | 'edit' } | null) => void
  onReplySubmitted: ({
    commentContent,
    isPrivate,
  }: {
    commentContent: string
    isPrivate: boolean
  }) => void
}) {
  const { siteInfo } = useSiteInfo()
  const { user } = useAuth()
  const locale = useLocale()
  const t = useTranslations('Comment')
  const roleT = useTranslations('Role')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const clickToLogin = useToLogin()

  const [commentState, setCommentState] = useState<Comment>(comment) // 用于更新评论内容
  const [likeCount, setLikeCount] = useState(commentState.likeCount)
  const [liked, setLiked] = useState(commentState.isLiked)
  const [canClickLike, setCanClickLike] = useState(true)
  const [replyCount, setReplyCount] = useState(commentState.replyCount)
  const [showReplies, setShowReplies] = useState(false)
  const [replies, setReplies] = useState<Comment[]>([])
  const [repliesLoaded, setRepliesLoaded] = useState(false)

  const handleToggleLike = () => {
    if (!canClickLike) {
      return
    }
    if (!user) {
      toast.error(commonT('login_required'), {
        action: {
          label: operationT('login'),
          onClick: clickToLogin,
        },
      })
      return
    }
    setCanClickLike(false)
    // 提前转换状态，让用户觉得响应很快
    const likedPrev = liked
    const likeCountPrev = likeCount
    setLiked(prev => !prev)
    setLikeCount(prev => prev + (likedPrev ? -1 : 1))
    toggleLike({ targetType: TargetType.Comment, targetId: commentState.id })
      .then((res) => {
        toast.success(res.data.status ? operationT('like_success') : operationT('unlike_success'))
        setCanClickLike(true)
      })
      .catch((error) => {
        toast.error(`${operationT('like_failed')}: ${getErrorMessage(error)}`)
        // 失败回滚
        setLiked(likedPrev)
        setLikeCount(likeCountPrev)
        setCanClickLike(true)
      })
  }

  const reloadReplies = () => {
    listComments({
      targetType: commentState.targetType,
      targetId: commentState.targetId,
      depth: commentState.depth + 1,
      orderBy: OrderBy.CreatedAt,
      desc: false,
      page: 1,
      size: 999999,
      commentId: commentState.id,
    }).then((response) => {
      setReplies(response.data.comments)
      setRepliesLoaded(true)
    }).catch((error) => {
      toast.error(`${t('load_failed')}: ${getErrorMessage(error)}`)
    })
  }

  const toggleReplies = () => {
    if (!showReplies && !repliesLoaded) {
      reloadReplies()
    }
    setShowReplies(!showReplies)
  }

  const onCommentEdit = async ({
    commentContent: newContent,
    isPrivate,
    showClientInfo,
  }: {
    commentContent: string
    isPrivate: boolean
    showClientInfo: boolean
  }) => {
    try {
      await updateComment({
        id: commentState.id,
        content: newContent,
        isPrivate,
        showClientInfo,
      })
      toast.success(t('edit_success'))
      getComment({ id: commentState.id }).then((response) => {
        setCommentState(response.data)
      }).catch(() => {})
      setActiveInputId(null)
    }
    catch (error) {
      toast.error(`${t('edit_failed')}: ${getErrorMessage(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
  }

  const onReply = async ({
    commentContent,
    isPrivate,
    showClientInfo,
  }: {
    commentContent: string
    isPrivate: boolean
    showClientInfo: boolean
  }) => {
    try {
      await createComment({
        targetType: commentState.targetType,
        targetId: commentState.targetId,
        content: commentContent,
        replyId: commentState.id,
        isPrivate,
        showClientInfo,
      })
    }
    catch (error) {
      toast.error(`${t('comment_failed')}: ${getErrorMessage(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
    toast.success(t('comment_success'))
    reloadReplies()
    setShowReplies(true)
    setActiveInputId(null)
    setReplyCount(c => c + 1)
    onReplySubmitted({ commentContent, isPrivate })
  }

  const onReplyDelete = ({ commentId: replyId }: { commentId: number }) => {
    deleteComment({ id: replyId })
      .then(() => {
        toast.success(t('delete_success'))
        setReplyCount(c => Math.max(0, c - 1))
        setReplies(prev => prev.filter(r => r.id !== replyId))
      })
      .catch((error) => {
        toast.error(`${t('delete_failed')}: ${getErrorMessage(error)}`)
      })
  }

  return (
    <div className={`${replyCount > 0 && showReplies ? 'border-l-2 border-dashed border-foreground/10 pl-3' : ''}`}>
      <div className="flex gap-2">
        <Link
          href={getUserUrl(commentState.user)}
          aria-label={t('view_user_profile', { name: commentState.user.nickname || commentState.user.username })}
          className="cursor-pointer fade-in w-10 h-10 shrink-0"
        >
          <UserAvatar user={commentState.user} className="size-full" />
        </Link>
        <div className="flex-1 fade-in-up">
          <div className="flex gap-2 md:gap-4 items-center flex-wrap">
            {/* 用户名 */}
            <Link
              href={getUserUrl(commentState.user)}
              data-user-color={
                commentState.user.preferredColor || siteInfo.defaultColorScheme || 'blue'
              }
              className="cursor-pointer font-bold text-primary hover:underline hover:decoration-dashed hover:underline-offset-4"
            >
              {commentState.user.nickname || commentState.user.username}
            </Link>

            <div className="flex items-center gap-2 flex-wrap">
              {/* 吧唧 */}
              {commentState.user.id === ownerId && (
                <Badge variant="secondary" className="rounded-md">
                  {roleT('author')}
                </Badge>
              )}
              {/* 创建时间 */}
              <span className="text-xs text-foreground/50 tabular-nums">
                {formatDateTime({
                  dateTimeString: commentState.createdAt,
                  locale,
                  convertShortAgo: true,
                  unitI18n: {
                    secondsAgo: commonT('secondsAgo'),
                    minutesAgo: commonT('minutesAgo'),
                    hoursAgo: commonT('hoursAgo'),
                    daysAgo: commonT('daysAgo'),
                  },
                })}
              </span>
              {commentState.createdAt !== commentState.updatedAt
                && new Date(commentState.updatedAt).getTime()
                - new Date(commentState.createdAt).getTime()
                > 10000 && (
                <span className="hidden text-xs text-foreground/50 md:flex">
                  {t('edit_at', {
                    time: formatDateTime({
                      dateTimeString: commentState.updatedAt,
                      locale,
                      convertShortAgo: true,
                      unitI18n: {
                        secondsAgo: commonT('secondsAgo'),
                        minutesAgo: commonT('minutesAgo'),
                        hoursAgo: commonT('hoursAgo'),
                        daysAgo: commonT('daysAgo'),
                      },
                    }),
                  })}
                </span>
              )}
            </div>
          </div>
          <p className="fade-in my-2 rounded-xl bg-foreground/[.03] px-4 py-2 text-foreground/75 break-words">
            {commentState.isPrivate && (
              <Lock aria-hidden className="mr-1 mb-1 inline size-4 text-foreground/50" />
            )}
            {/* 回复提示 */}
            {parentComment && (
              <span>
                {t('reply')}
                <Link
                  href={getUserUrl(parentComment.user)}
                  data-user-color={parentComment.user.preferredColor || siteInfo.defaultColorScheme || 'blue'}
                  className="mx-1 cursor-pointer font-bold text-primary hover:underline hover:decoration-dashed hover:underline-offset-4"
                >
                  {parentComment.user.nickname || parentComment.user.username}
                </Link>
                :
                {' '}
              </span>
            )}
            {commentState.content}
          </p>
          <div className="flex items-center justify-between gap-2 text-xs text-foreground/50">
            <div className="flex items-center gap-2 justify-start flex-wrap">
              {/* 用户地理，浏览器，系统信息 */}
              {commentState.location && (
                <span>
                  {formatLocation({
                    location: commentState.location,
                    short: true,
                  })}
                </span>
              )}
              {commentState.browser && (
                <span className="hidden md:flex">{commentState.browser}</span>
              )}
              {commentState.os && <span className="hidden md:flex">{commentState.os}</span>}
            </div>
            <div className="flex items-center gap-2 md:w-auto justify-end">
              {replyCount > 0 && (
                <button type="button" onClick={toggleReplies} className="fade-in-up">
                  {!showReplies
                    ? t('expand_replies', { count: replyCount })
                    : t('collapse_replies')}
                </button>
              )}
              {/* 更多 */}
              {user && (user.id === comment.user.id || isAdmin({ user })) && (
                <CommentDropdownMenu
                  comment={commentState}
                  setActiveInputId={setActiveInputId}
                  onCommentDelete={onCommentDelete}
                />
              )}

              {/* 回复按钮 */}
              <button
                type="button"
                title={t('reply')}
                aria-label={t('reply')}
                onClick={() => {
                  if (activeInput?.type === 'reply' && activeInput.id === commentState.id) {
                    setActiveInputId(null)
                  }
                  else {
                    setActiveInputId({ id: commentState.id, type: 'reply' })
                  }
                }}
                className={`fade-in-up flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs transition-colors hover:bg-primary/15 hover:text-primary ${activeInput?.type === 'reply' && activeInput.id === commentState.id ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground'}`}
              >
                <Reply aria-hidden className="size-3.5" />
              </button>
              {/* 点赞按钮 */}
              <button
                type="button"
                title={liked ? operationT('unlike') : operationT('like')}
                aria-label={liked ? operationT('unlike') : operationT('like')}
                aria-pressed={liked}
                onClick={handleToggleLike}
                className={`fade-in flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-2 text-xs tabular-nums transition-colors ${liked ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-primary/15 hover:text-primary'}`}
              >
                <Heart aria-hidden className={`size-3.5 ${liked ? 'fill-current' : ''}`} />
                {' '}
                <div>{likeCount}</div>
              </button>
            </div>
          </div>
        </div>
        {/* 这俩输入框一次只能显示一个 */}
      </div>
      {activeInput && activeInput.type === 'reply' && activeInput.id === commentState.id && (
        <CommentInput
          onCommentSubmitted={onReply}
          initIsPrivate={commentState.isPrivate}
          placeholder={`${t('reply')} ${commentState.user.nickname || commentState.user.username} :`}
        />
      )}
      {activeInput && activeInput.type === 'edit' && activeInput.id === commentState.id && (
        <CommentInput
          initContent={commentState.content}
          initIsPrivate={commentState.isPrivate}
          onCommentSubmitted={onCommentEdit}
          isUpdate={true}
          initShowClientInfo={commentState.showClientInfo}
        />
      )}
      {showReplies && replies.length > 0 && (
        <div className="mt-4 pl-4 md:pl-8 space-y-4">
          {replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              ownerId={ownerId}
              parentComment={commentState}
              onCommentDelete={onReplyDelete}
              activeInput={activeInput}
              setActiveInputId={setActiveInputId}
              onReplySubmitted={onReplySubmitted}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CommentDropdownMenu({
  comment,
  setActiveInputId,
  onCommentDelete,
}: {
  comment: Comment
  setActiveInputId: (input: { id: number, type: 'reply' | 'edit' } | null) => void
  onCommentDelete: ({ commentId }: { commentId: number }) => void
}) {
  const { confirming: confirmingDelete, onClick: onDeleteClick } = useDoubleConfirm()
  const operationT = useOperationT()
  const t = useTranslations('Comment')
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('more_actions')}>
          <Ellipsis className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1">
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start cursor-pointer"
            onClick={() => {
              setActiveInputId({ id: comment.id, type: 'edit' })
              setOpen(false)
            }}
          >
            {operationT('edit')}
          </Button>
          <div className="h-px bg-border my-1" />
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-destructive"
            onClick={(e) => {
              // double confirm hook 控制是否需要二次确认
              if (!confirmingDelete) {
                e.preventDefault()
                onDeleteClick(() => onCommentDelete({ commentId: comment.id }))
              }
              else {
                onDeleteClick(() => onCommentDelete({ commentId: comment.id }))
                setOpen(false)
              }
            }}
          >
            {confirmingDelete ? operationT('confirm_delete') : operationT('delete')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
