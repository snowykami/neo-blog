import type { CommentSubmitPayload } from './comment-input'
import type { Comment, CommentTranslation } from '@/models/comment'
import type { User, UserBrief } from '@/models/user'
import { ChevronDown, Ellipsis, Languages, Loader2, Lock, MessageCircleHeartIcon, Reply } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createComment, deleteComment, getComment, listCommentThread, translateComment, updateComment } from '@/api/comment'
import { toggleLike } from '@/api/like'
import { useRequireLogin } from '@/components/auth/login-dialog'
import { UserAvatar } from '@/components/common/avatar'
import { Popconfirm } from '@/components/common/popconfirm'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { LikeIcon } from '@/contexts/theme-context'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { toServiceLanguage } from '@/locales/registry'
import { TargetType } from '@/models/types'
import { formatDateTime } from '@/utils/common/datetime'
import { formatLocation } from '@/utils/common/location'
import { isAdmin } from '@/utils/common/permission'
import { getUserUrl } from '@/utils/common/route'
import { CommentAttachments } from './comment-attachments'
import { CommentInput } from './comment-input'
import { useCommentLimits } from './comment-limits'
import { CommentText } from './comment-text'

export type ActiveInput = { id: number, type: 'reply' | 'edit' } | null

// 展开回复后先显示的条数，其余点「展开剩余」
const THREAD_PAGE = 5

/**
 * 主评论：主评论本身与它下面的整个回复线程。回复不论多少层都平铺在主评论下一层，
 * 用小头像与连线表达层级；回复的是另一条回复时才显示 @某人
 */
export function CommentItem({
  comment,
  ownerId,
  sectionUsers,
  onCommentDelete,
  activeInput,
  setActiveInputId,
  onCountChange,
  translatable = false,
  focusRootId,
  focusCommentId,
}: {
  comment: Comment
  ownerId?: number // 不是评论的作者ID，而是文章的作者ID
  sectionUsers?: UserBrief[] // 本帖上下文候选用户（文章作者与其他评论者）
  onCommentDelete: ({ commentId }: { commentId: number }) => Promise<void>
  activeInput: ActiveInput
  setActiveInputId: (input: ActiveInput) => void
  onCountChange: (delta: number) => void // 评论区总数的变化
  translatable?: boolean // 后端已配置 AI，显示翻译按钮
  // 通知深链：这条线程被定位时自动展开，focusCommentId 是具体的评论（根或某个回复）
  focusRootId?: number
  focusCommentId?: number
}) {
  const locale = useLocale()
  const targetLang = toServiceLanguage(locale)
  const t = useTranslations('Comment')
  const errorMessageT = useErrorMessageT()
  const [root, setRoot] = useState(comment)
  const [prevComment, setPrevComment] = useState(comment)
  if (prevComment !== comment) {
    setPrevComment(comment)
    setRoot(comment)
  }
  const [replies, setReplies] = useState<Comment[] | null>(null) // 展开后才加载
  const [expanded, setExpanded] = useState(false)
  const [shown, setShown] = useState(THREAD_PAGE)

  const loadThread = useCallback(async () => {
    try {
      const res = await listCommentThread({ targetType: root.targetType, targetId: root.targetId, rootId: root.id, targetLang })
      setReplies(res.data.comments ?? [])
      return res.data.comments?.length ?? 0
    }
    catch (error) {
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
      return null
    }
  }, [root.targetType, root.targetId, root.id, targetLang, t, errorMessageT])

  const threadLangRef = useRef(targetLang)
  useEffect(() => {
    if (threadLangRef.current === targetLang)
      return
    threadLangRef.current = targetLang
    if (replies !== null)
      void loadThread()
  }, [targetLang, replies, loadThread])

  const toggleThread = () => {
    if (!expanded && replies === null)
      void loadThread()
    setExpanded(!expanded)
    setShown(THREAD_PAGE)
  }

  // 加载后以实际可见的回复为准，未加载时用列表接口带回的线程摘要
  const threadCount = replies?.length ?? root.threadCount ?? 0
  const threadUsers = useMemo(() => {
    if (!replies)
      return root.threadUsers ?? []
    const seen = new Map<number, User>()
    replies.forEach(reply => seen.has(reply.user.id) || seen.set(reply.user.id, reply.user))
    return [...seen.values()].slice(0, 3)
  }, [replies, root.threadUsers])
  const byId = useMemo(() => new Map((replies ?? []).map(reply => [reply.id, reply])), [replies])
  // 折叠时药丸上会带第一个回复者的昵称，昵称可能很长，这里只负责文案，截断交给 CSS
  const threadBy = !expanded && threadUsers[0]
    ? t('thread_by', { name: threadUsers[0].nickname || threadUsers[0].username, more: threadUsers.length - 1 })
    : ''

  const onReply = async (target: Comment, { commentContent, attachments, mentionUserIds, isPrivate, showClientInfo }: CommentSubmitPayload) => {
    try {
      await createComment({
        targetType: root.targetType,
        targetId: root.targetId,
        content: commentContent,
        attachmentIds: attachments.map(attachment => attachment.id),
        mentionUserIds,
        replyId: target.id,
        isPrivate,
        showClientInfo,
      })
    }
    catch (error) {
      toast.error(`${t('comment_failed')}: ${errorMessageT(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
    notifySuccess(t('comment_success'), { key: 'comment', icon: <MessageCircleHeartIcon aria-hidden className="text-sky-400" /> })
    setActiveInputId(null)
    onCountChange(1)
    await loadThread()
    setExpanded(true)
    setShown(Infinity)
  }

  // 删除回复会连同它下面的回复一起删除，按重新加载后的数量更新总数
  const onReplyDelete = async ({ commentId }: { commentId: number }) => {
    await deleteComment({ id: commentId })
    toast.success(t('delete_success'))
    const before = replies?.length ?? 0
    const after = await loadThread()
    onCountChange(-(after === null ? 1 : before - after))
  }

  // 当前线程参与者 + 本帖作者与其他评论者，供回复框与编辑框敲下空 @ 时优先推荐
  const threadContextUsers = useMemo(() => {
    const list: UserBrief[] = [root.user]
    if (replies)
      replies.forEach(reply => list.push(reply.user))
    else if (root.threadUsers)
      list.push(...root.threadUsers)
    if (sectionUsers)
      list.push(...sectionUsers)
    return list
  }, [replies, root.threadUsers, root.user, sectionUsers])

  const replying = activeInput?.type === 'reply' ? activeInput.id : null
  const replyComposer = (target: Comment) => (
    <div className="comment-thread-composer">
      <CommentInput
        autoFocus
        replyTo={target.user.nickname || target.user.username}
        contextUsers={[target.user, ...threadContextUsers]}
        ownerId={ownerId}
        initIsPrivate={target.isPrivate}
        onCancel={() => setActiveInputId(null)}
        onCommentSubmitted={payload => onReply(target, payload)}
      />
    </div>
  )

  // 通知深链落在这条线程上：直接展开整条线程，等回复加载完再滚到那条评论。
  // 展开与滚动对每个目标只做一次（ref 记录，Activity 隐藏再显示也保留）：之后读者收起线程、加载更多、展开别的线程都不再被拉回
  const focused = focusRootId === root.id
  const autoExpandedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focused || !focusCommentId || autoExpandedRef.current === focusCommentId)
      return
    autoExpandedRef.current = focusCommentId
    void loadThread()
    setExpanded(true)
    setShown(Infinity)
  }, [focused, focusCommentId, loadThread])

  const scrolledRef = useRef<number | null>(null)
  useEffect(() => {
    // 只由目标所在的线程负责滚动；目标是回复时等回复加载完
    if (!focused || !focusCommentId || scrolledRef.current === focusCommentId)
      return
    if (focusCommentId !== root.id && replies === null)
      return
    // 回复已不可见（被删除、私密）时退回到线程根
    const node = document.getElementById(`comment-${focusCommentId}`) ?? document.getElementById(`comment-${root.id}`)
    if (!node)
      return
    // 等一帧，等线程展开后的布局稳定再滚动；滚动后才记为已完成，等待期间依赖变化会重新安排
    const timer = window.setTimeout(() => {
      scrolledRef.current = focusCommentId
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [focusCommentId, focused, replies, root.id])

  const visibleReplies = expanded && replies ? replies.slice(0, shown) : []
  const highlighted = focusCommentId === root.id
  return (
    // 不用 article：正文排版样式（article img 等）会作用到评论里的头像
    <div className="comment-root border-t border-dashed border-foreground/10 py-4 first:border-t-0">
      <div id={`comment-${root.id}`} className={cn(highlighted && 'comment-highlight')}>
        <CommentBody
          comment={root}
          variant="root"
          ownerId={ownerId}
          contextUsers={threadContextUsers}
          activeInput={activeInput}
          setActiveInputId={setActiveInputId}
          onDelete={onCommentDelete}
          onUpdated={setRoot}
          translatable={translatable}
        />
      </div>
      {(threadCount > 0 || replying === root.id) && (
        <div className={cn('comment-thread', !expanded && 'is-collapsed')}>
          {visibleReplies.map((reply) => {
            // 只有回复的是另一条回复时才显示 @某人（被回复的那条不可见时不显示）
            const target = reply.replyId === root.id ? undefined : byId.get(reply.replyId)
            return (
              <div key={reply.id} id={`comment-${reply.id}`} className={cn(focusCommentId === reply.id && 'comment-highlight')}>
                <div className="comment-reply">
                  <CommentBody
                    comment={reply}
                    variant="reply"
                    replyToUser={target?.user}
                    ownerId={ownerId}
                    contextUsers={threadContextUsers}
                    activeInput={activeInput}
                    setActiveInputId={setActiveInputId}
                    onDelete={onReplyDelete}
                    onUpdated={updated => setReplies(prev => prev?.map(r => (r.id === updated.id ? updated : r)) ?? prev)}
                    translatable={translatable}
                  />
                </div>
                {replying === reply.id && replyComposer(reply)}
              </div>
            )
          })}
          {expanded && replies && replies.length > shown && (
            <button type="button" className="comment-thread-more" onClick={() => setShown(Infinity)}>
              {t('show_remaining', { count: replies.length - shown })}
            </button>
          )}
          {replying === root.id && replyComposer(root)}
          {threadCount > 0 && (
            <button type="button" className="comment-thread-toggle" aria-expanded={expanded} onClick={toggleThread}>
              <span className="flex shrink-0">
                {threadUsers.map(u => (
                  <UserAvatar key={u.id} user={u} size={40} className="-ml-1.5 size-5 border-2 border-card first:ml-0" fallbackClassName="text-[9px]" />
                ))}
              </span>
              <span className="shrink-0">{expanded ? t('collapse_thread') : t('thread_replies', { count: threadCount })}</span>
              {threadBy && (
                <span className="comment-thread-user text-muted-foreground" title={threadBy}>
                  ·
                  {' '}
                  {threadBy}
                </span>
              )}
              <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 单条评论：头像、名字与时间地点、内容、操作（回复、点赞、更多）；编辑时在下方打开编辑框
 */
function CommentBody({
  comment,
  variant,
  replyToUser,
  ownerId,
  contextUsers,
  activeInput,
  setActiveInputId,
  onDelete,
  onUpdated,
  translatable,
}: {
  comment: Comment
  variant: 'root' | 'reply'
  replyToUser?: User
  ownerId?: number
  contextUsers?: UserBrief[]
  activeInput: ActiveInput
  setActiveInputId: (input: ActiveInput) => void
  onDelete: ({ commentId }: { commentId: number }) => Promise<void>
  onUpdated: (comment: Comment) => void
  translatable: boolean
}) {
  const { siteInfo } = useSiteInfo()
  const { collapsedLines } = useCommentLimits()
  const { user } = useAuth()
  const locale = useLocale()
  // 评论翻译接口只区分简繁（zh / zh-tw），地区变体共用同一份译文
  const targetLang = toServiceLanguage(locale)
  const t = useTranslations('Comment')
  const errorMessageT = useErrorMessageT()
  const roleT = useTranslations('Role')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const requireLogin = useRequireLogin()
  const [likeCount, setLikeCount] = useState(comment.likeCount)
  const [liked, setLiked] = useState(comment.isLiked)
  const [liking, setLiking] = useState(false)
  // 本页刚点击翻译得到的译文连同当时的原文一起记录；未点击时直接使用随评论返回的已缓存译文
  const [localTranslation, setLocalTranslation] = useState<{ source: string, data: CommentTranslation } | null>(null)
  // 已有目标语言译文时默认直接展示；读者点「显示原文」后记下当前语言与原文，再点切回译文
  const [hiddenKey, setHiddenKey] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const translationKey = `${targetLang}:${comment.content}`
  const currentTranslation = localTranslation?.source === comment.content && localTranslation.data.targetLang === targetLang
    ? localTranslation.data
    : (comment.translation?.targetLang === targetLang ? comment.translation : null)
  const translated = hiddenKey !== translationKey && currentTranslation && !currentTranslation.sameLanguage ? currentTranslation : null
  // 评论语言：本页刚识别出的优先（内容未变时），否则用后端记录的；与界面语言相同时不显示翻译按钮
  const language = localTranslation?.source === comment.content
    ? localTranslation.data.sourceLang
    : (comment.language || currentTranslation?.sourceLang || '')

  // 未登录时由 requireLogin 弹出快捷登录，登录后接着执行，因此这里不再判断登录状态
  const like = () => {
    if (liking)
      return
    setLiking(true)
    // 提前转换状态，让用户觉得响应很快
    const likedPrev = liked
    const likeCountPrev = likeCount
    setLiked(!likedPrev)
    setLikeCount(likeCountPrev + (likedPrev ? -1 : 1))
    // 传入期望状态：快捷登录后页面上的点赞状态可能已过期，避免把已赞的点成取消
    toggleLike({ targetType: TargetType.Comment, targetId: comment.id, liked: !likedPrev })
      .then(res => toast.success(res.data.status ? operationT('like_success') : operationT('unlike_success')))
      .catch((error) => {
        toast.error(`${operationT('like_failed')}: ${errorMessageT(error)}`)
        // 失败回滚
        setLiked(likedPrev)
        setLikeCount(likeCountPrev)
      })
      .finally(() => setLiking(false))
  }

  const handleToggleLike = () => requireLogin(like, 'like')

  const showTranslationResult = (result: CommentTranslation) => {
    if (result.sameLanguage)
      toast.info(t('translate_same_language'))
    else
      setHiddenKey(null)
  }

  // 已有译文时默认展示，点击可在译文与原文间切换；尚无译文时请求翻译成当前界面语言
  const toggleTranslation = () => {
    if (translated) {
      setHiddenKey(translationKey)
      return
    }
    if (currentTranslation) {
      showTranslationResult(currentTranslation)
      return
    }
    if (translating)
      return
    setTranslating(true)
    const source = comment.content
    translateComment({ id: comment.id, targetLang })
      .then((res) => {
        // 等待期间评论被编辑时，原文对不上，译文不会显示
        setLocalTranslation({ source, data: res.data })
        showTranslationResult(res.data)
      })
      .catch(error => toast.error(`${t('translate_failed')}: ${errorMessageT(error)}`))
      .finally(() => setTranslating(false))
  }

  const toggleReply = () => requireLogin(() => {
    const active = activeInput?.type === 'reply' && activeInput.id === comment.id
    setActiveInputId(active ? null : { id: comment.id, type: 'reply' })
  }, 'reply')

  const onEdit = async ({ commentContent, attachments, mentionUserIds, isPrivate, showClientInfo }: CommentSubmitPayload) => {
    try {
      await updateComment({
        id: comment.id,
        content: commentContent,
        attachmentIds: attachments.map(attachment => attachment.id),
        mentionUserIds,
        isPrivate,
        showClientInfo,
      })
      toast.success(t('edit_success'))
      getComment({ id: comment.id, targetLang })
        .then(res => onUpdated({ ...res.data, threadCount: comment.threadCount, threadUsers: comment.threadUsers }))
        .catch(() => {})
      setActiveInputId(null)
    }
    catch (error) {
      toast.error(`${t('edit_failed')}: ${errorMessageT(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
  }

  const time = (dateTimeString: string) => formatDateTime({
    dateTimeString,
    locale,
    convertShortAgo: true,
    unitI18n: { secondsAgo: commonT('secondsAgo'), minutesAgo: commonT('minutesAgo'), hoursAgo: commonT('hoursAgo'), daysAgo: commonT('daysAgo') },
  })
  const name = (u: User) => u.nickname || u.username
  const userColor = (u: User) => u.preferredColor || siteInfo.defaultColorScheme || 'blue'
  const edited = new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 10000
  const device = [comment.browser, comment.os].map(s => s.trim()).filter(Boolean).join(' · ')
  const replyActive = activeInput?.type === 'reply' && activeInput.id === comment.id
  const editing = activeInput?.type === 'edit' && activeInput.id === comment.id
  const isRoot = variant === 'root'
  const hasText = comment.content.trim() !== ''
  const canTranslate = (translatable || Boolean(currentTranslation && !currentTranslation.sameLanguage)) && hasText && language !== targetLang
  const canEdit = Boolean(user && (user.id === comment.user.id || isAdmin({ user })))
  const canDelete = Boolean(canEdit || (user && ownerId && user.id === ownerId))

  return (
    <div className="group/comment">
      <div className="flex gap-3">
        <Link
          href={getUserUrl(comment.user, 'comments')}
          aria-label={t('view_user_profile', { name: name(comment.user) })}
          className={cn('shrink-0', isRoot ? 'size-9 sm:size-10' : 'size-7')}
        >
          <UserAvatar user={comment.user} className="size-full" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-snug">
            <Link
              href={getUserUrl(comment.user, 'comments')}
              data-user-color={userColor(comment.user)}
              className="font-bold text-primary hover:underline hover:decoration-dashed hover:underline-offset-4"
            >
              {name(comment.user)}
            </Link>
            {comment.user.id === ownerId && <Badge variant="secondary" className="h-[18px] rounded-md px-1.5 text-[11px]">{roleT('author')}</Badge>}
            {comment.isPrivate && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Lock aria-hidden className="size-3" />
                {t('private')}
              </span>
            )}
            <span className="comment-meta tabular-nums">{time(comment.createdAt)}</span>
            {edited && <span className="comment-meta hidden md:inline">{t('edit_at', { time: time(comment.updatedAt) })}</span>}
            {comment.location && formatLocation({ location: comment.location, short: true }) && (
              <span className="comment-meta comment-meta-dot">{formatLocation({ location: comment.location, short: true })}</span>
            )}
            {isRoot && device && <span className="comment-meta comment-meta-dot hidden md:inline">{device}</span>}
          </div>
          {/* 只有附件的评论没有正文，回复时仍显示 @某人 */}
          {(hasText || replyToUser) && (
            <p lang={translated?.targetLang} className={cn('mt-1 mb-0.5 break-words whitespace-pre-wrap text-foreground/85', !isRoot && 'text-[0.95em]')}>
              <CommentText
                key={translated ? `tr:${translated.targetLang}` : 'orig'}
                content={translated ? translated.content : comment.content}
                mentions={translated ? undefined : comment.mentions}
                lines={collapsedLines}
                prefix={replyToUser && (
                  <Link
                    href={getUserUrl(replyToUser, 'comments')}
                    data-user-color={userColor(replyToUser)}
                    className="mr-1 font-semibold text-primary hover:underline"
                  >
                    @
                    {name(replyToUser)}
                  </Link>
                )}
              />
            </p>
          )}
          {translated && (
            <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Languages aria-hidden className="size-3" />
              {t('translated_from', { language: languageName(translated.sourceLang, locale) })}
            </p>
          )}
          <CommentAttachments attachments={comment.attachments} className="mt-1.5 mb-1" />
          {/* 手机上按钮加大到 36px、拉开间距，避免误触相邻的按钮 */}
          <div className="-ml-2 flex items-center gap-0.5 text-xs text-muted-foreground max-sm:gap-1.5">
            <button
              type="button"
              title={t('reply')}
              aria-label={t('reply')}
              onClick={toggleReply}
              aria-pressed={replyActive}
              className={cn('inline-flex h-7 min-w-7 max-sm:h-9 max-sm:min-w-9 items-center justify-center rounded-md px-2 transition-colors hover:bg-muted hover:text-foreground', replyActive && 'text-primary')}
            >
              <Reply aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              // 状态由 aria-pressed 表达，名称保持「点赞」不随状态变化
              title={liked ? operationT('unlike') : operationT('like')}
              aria-label={operationT('like')}
              aria-pressed={liked}
              onClick={handleToggleLike}
              className={cn('inline-flex h-7 min-w-7 max-sm:h-9 max-sm:min-w-9 items-center gap-1 rounded-md px-2 tabular-nums transition-colors hover:bg-muted hover:text-foreground', liked && 'text-primary hover:text-primary')}
            >
              <LikeIcon className={cn('size-3.5', liked && 'fill-current')} />
              {likeCount > 0 && likeCount}
            </button>
            {canTranslate && (
              <button
                type="button"
                title={translating ? t('translating') : translated ? t('show_original') : t('translate')}
                aria-label={translating ? t('translating') : translated ? t('show_original') : t('translate')}
                aria-pressed={Boolean(translated)}
                aria-busy={translating}
                disabled={translating}
                onClick={toggleTranslation}
                className={cn('inline-flex h-7 min-w-7 max-sm:h-9 max-sm:min-w-9 items-center justify-center rounded-md px-2 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait', translated && 'text-primary hover:text-primary')}
              >
                {translating
                  ? <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  : <Languages aria-hidden className="size-3.5" />}
              </button>
            )}
            {canDelete && (
              // 能悬停的设备（鼠标）悬停时才显示「更多」；触屏手机、平板不能悬停，始终显示
              <span className="ml-auto transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/comment:opacity-100 [@media(hover:hover)]:group-hover/comment:opacity-100">
                <CommentDropdownMenu comment={comment} canEdit={canEdit} setActiveInputId={setActiveInputId} onCommentDelete={onDelete} />
              </span>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <div className={cn('mt-2', isRoot ? 'sm:ml-13' : 'ml-10')}>
          <CommentInput
            autoFocus
            isUpdate
            initContent={comment.content}
            initMentions={comment.mentions}
            initAttachments={comment.attachments}
            initIsPrivate={comment.isPrivate}
            initShowClientInfo={comment.showClientInfo}
            contextUsers={[...(comment.mentions ?? []), ...(replyToUser ? [replyToUser] : []), ...(contextUsers ?? [])]}
            ownerId={ownerId}
            onCancel={() => setActiveInputId(null)}
            onCommentSubmitted={onEdit}
          />
        </div>
      )}
    </div>
  )
}

// 语言代码 → 当前界面语言下的名称（zh / zh-tw 显示为简体 / 繁体中文），无法识别时显示代码本身
function languageName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code === 'zh' ? 'zh-Hans' : code === 'zh-tw' ? 'zh-Hant' : code) ?? code
  }
  catch {
    return code
  }
}

function CommentDropdownMenu({
  comment,
  canEdit,
  setActiveInputId,
  onCommentDelete,
}: {
  comment: Comment
  canEdit: boolean
  setActiveInputId: (input: ActiveInput) => void
  onCommentDelete: ({ commentId }: { commentId: number }) => Promise<void>
}) {
  const operationT = useOperationT()
  const t = useTranslations('Comment')
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    // 菜单关闭后，删除确认气泡以菜单按钮所在位置为锚点就地弹出；
    // 锚点包在菜单 Popover 外层，避免菜单触发器取到确认气泡的 Popover 上下文
    <Popconfirm
      anchorOnly
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={t('delete_confirm_title')}
      description={t('delete_confirm_description')}
      confirmText={operationT('delete')}
      errorText={t('delete_failed')}
      destructive
      onConfirm={() => onCommentDelete({ commentId: comment.id })}
    >
      <span className="inline-flex">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground max-sm:size-9" aria-label={t('more_actions')}>
              <Ellipsis className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-1"
            // 打开删除确认时不把焦点还给菜单按钮，焦点交给气泡
            onCloseAutoFocus={e => confirmOpen && e.preventDefault()}
          >
            <div className="flex flex-col">
              {canEdit && (
                <>
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
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-destructive"
                onClick={() => {
                  setOpen(false)
                  setConfirmOpen(true)
                }}
              >
                {operationT('delete')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </Popconfirm>
  )
}
