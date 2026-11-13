import type { CommentAttachment, CommentMention } from '@/models/comment'
import type { UserBrief } from '@/models/user'
import { AtSign, Loader2, Lock, LogIn, Monitor, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useLoginDialog } from '@/components/auth/login-dialog'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { GuestAvatar, UserAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { useAuth } from '@/contexts/auth-context'
import { pastedFilesOf, withPastedFileNames } from '@/hooks/use-clipboard-file-paste'
import { useOperationT } from '@/hooks/use-translations'
import { Link, usePathname } from '@/i18n/navigation'
import { isComposingKey } from '@/lib/ime'
import { cn } from '@/lib/utils'
import { highlightMentions, mentionsUser } from '@/utils/common/mention'
import { getUserUrl } from '@/utils/common/route'
import { CommentAttachmentButton, CommentAttachmentList, useCommentAttachments } from './comment-attachment-input'
import { CommentLengthRing } from './comment-length-ring'
import { commentCharCount, useCommentLimits } from './comment-limits'
import { MentionCandidates, mentionOptionId } from './mention-candidates'
import { MAX_COMMENT_MENTIONS, useMention } from './use-mention'

/**
 * 评论框：未登录时显示登录邀请卡片；登录后为带工具栏的输入框（附件、@提及、私密、显示设备信息、⌘/Ctrl + Enter 发布）。
 * 附件可直接粘贴 / 拖入，也可从资产库选择，排在文字之后展示；有附件时可以不写文字。
 * collapsible 时平时收起成一行，聚焦或有内容时展开工具栏；replyTo 时在框内显示「回复 @某人」
 */
export function CommentInput({
  onCommentSubmitted,
  initContent = '',
  initMentions,
  initAttachments,
  initIsPrivate = false,
  placeholder = '',
  isUpdate = false,
  initShowClientInfo = false, // 设备与归属地默认不公开，评论者勾选后才展示
  collapsible = false,
  showAvatar = false,
  autoFocus = false,
  replyTo,
  contextUsers,
  ownerId,
  onCancel,
}: {
  onCommentSubmitted: (payload: CommentSubmitPayload) => Promise<void> // 失败时需 reject，以便保留输入内容
  initContent?: string
  initMentions?: CommentMention[] // 编辑已有评论时带入原来被 @ 的人（id 与当前用户名）
  initAttachments?: CommentAttachment[]
  initIsPrivate?: boolean
  placeholder?: string
  isUpdate?: boolean
  initShowClientInfo?: boolean
  collapsible?: boolean
  showAvatar?: boolean // 在输入框左侧显示当前用户头像（主评论框）
  autoFocus?: boolean
  replyTo?: string // 回复对象的名字
  contextUsers?: UserBrief[] // 本帖作者与当前讨论参与者，敲下空 @ 时 0ms 即时推荐
  ownerId?: number // 文章/页面作者 ID，用于在候选里标注「作者」
  onCancel?: () => void
}) {
  const { user, loading: authLoading } = useAuth()
  const t = useTranslations('Comment')
  const operationT = useOperationT()

  const [isPrivate, setIsPrivate] = useState(initIsPrivate)
  const [showClientInfo, setShowClientInfo] = useState(initShowClientInfo)
  const [commentContent, setCommentContent] = useState(initContent)
  const [submitting, setSubmitting] = useState(false) // 提交中，防止重复提交
  const { maxLength } = useCommentLimits()
  // 与后端一致的字数（去首尾空白、按字符数），超出上限时不允许发布
  const charCount = commentCharCount(commentContent)
  const tooLong = charCount > maxLength
  const [focused, setFocused] = useState(false)
  const attachments = useCommentAttachments(initAttachments)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mac = useIsMac()
  const mentionListId = useId()
  const mention = useMention({
    value: commentContent,
    textareaRef,
    onChange: setCommentContent,
    contextUsers,
    currentUserId: user?.id,
    onExceedLimit: () => toast.warning(t('mentions_max', { count: MAX_COMMENT_MENTIONS })),
  })
  // 编辑已有评论时带上原来的提及，之后新选的会追加在后面
  const [seeded, setSeeded] = useState(false)
  if (!seeded && initMentions && initMentions.length > 0) {
    mention.seed(initMentions)
    setSeeded(true)
  }

  const hasHighlight = mention.activeUsernames.length > 0 && commentContent.length > 0
  const highlightSegments = useMemo(
    () => (hasHighlight ? highlightMentions(commentContent, mention.activeUsernames) : []),
    [commentContent, hasHighlight, mention.activeUsernames],
  )
  const initMentionIds = useMemo(
    () => [...new Set((initMentions ?? []).filter(m => mentionsUser(initContent, m.username)).map(m => m.id))].slice(0, MAX_COMMENT_MENTIONS),
    [initContent, initMentions],
  )

  // 登录状态在浏览器里确认，确认前显示占位，避免先闪出登录邀请
  if (authLoading)
    return <Skeleton aria-hidden className="h-24 w-full rounded-xl" />
  if (!user)
    return <GuestInvite />

  const empty = !commentContent.trim() && attachments.items.length === 0
  const expanded = !collapsible || focused || !empty || attachments.pickerOpen || mention.open
  const attachmentIds = attachments.attachments.map(attachment => attachment.id)
  const currentMentionIds = mention.mentions()
  const unchanged = isUpdate
    && commentContent.trim() === initContent.trim()
    && isPrivate === initIsPrivate
    && showClientInfo === initShowClientInfo
    && attachmentIds.join() === (initAttachments ?? []).map(attachment => attachment.id).join()
    && currentMentionIds.join() === initMentionIds.join()

  const handleCommentSubmit = async () => {
    if (submitting)
      return
    if (attachments.uploading) {
      toast.warning(t('attachments_uploading'))
      return
    }
    // 内容为空时发布按钮已禁用，⌘/Ctrl + Enter 也静默忽略，不弹错误
    if (empty)
      return
    if (tooLong) {
      toast.error(t('length_over', { over: charCount - maxLength, max: maxLength }))
      return
    }
    if (unchanged) {
      toast.warning(t('comment_unchanged'))
      return
    }
    setSubmitting(true)
    try {
      await onCommentSubmitted({
        commentContent,
        attachments: attachments.attachments,
        isPrivate,
        showClientInfo,
        mentionUserIds: currentMentionIds,
      })
      // 仅在提交成功后清空，失败时保留用户输入
      setCommentContent('')
      attachments.clear()
      mention.reset()
      setFocused(false)
    }
    catch {
      // 错误提示由调用方负责
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex gap-3 fade-in-up">
      {showAvatar && (
        <Link
          href={getUserUrl(user, 'comments')}
          aria-label={t('view_user_profile', { name: user.nickname || user.username })}
          className="hidden size-10 shrink-0 sm:block"
        >
          <UserAvatar user={user} className="size-full" />
        </Link>
      )}
      <div
        className={cn(
          'min-w-0 flex-1 rounded-xl border bg-card transition-[border-color,box-shadow]',
          (focused || !collapsible) && 'border-primary/50 ring-3 ring-primary/15',
        )}
        onFocus={() => setFocused(true)}
        // 焦点移出评论框时收起工具栏与提及浮层（浮层内部按钮阻止了 mousedown 默认失焦，不受影响）
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setFocused(false)
            mention.close()
          }
        }}
        // 拖入文件作为附件，避免浏览器直接打开文件；资产库弹窗（Portal）里的拖放事件也会冒泡到这里，需排除
        onDragOver={e => e.currentTarget.contains(e.target as Node) && e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files)
          if (files.length === 0 || !e.currentTarget.contains(e.target as Node))
            return
          e.preventDefault()
          attachments.addFiles(files)
        }}
      >
        {replyTo && (
          <span className="mt-2 ml-2.5 inline-flex max-w-[calc(100%-0.625rem)] items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2 text-xs text-secondary-foreground">
            <span className="truncate">{t('reply_to', { name: replyTo })}</span>
            {onCancel && (
              <button type="button" onClick={onCancel} aria-label={t('cancel_reply')} className="shrink-0 rounded-full p-0.5 opacity-70 hover:opacity-100">
                <X className="size-3" />
              </button>
            )}
          </span>
        )}
        <Popover open={mention.open}>
          <PopoverAnchor asChild>
            <div className="relative grid">
              {hasHighlight && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none col-start-1 row-start-1 w-full px-3 py-2 font-sans text-base leading-6 whitespace-pre-wrap wrap-break-word md:text-sm md:leading-5',
                    expanded ? 'min-h-16' : 'min-h-10',
                  )}
                >
                  {highlightSegments.map((seg, index) => seg.matched
                    ? (
                        <mark
                          key={index}
                          className={cn(
                            'rounded-[3px] bg-primary/15',
                            mention.composing ? 'text-transparent' : 'text-primary',
                          )}
                        >
                          {seg.text}
                        </mark>
                      )
                    : (
                        <span key={index} className={mention.composing ? 'text-transparent' : 'text-foreground'}>
                          {seg.text}
                        </span>
                      ))}
                  {commentContent.endsWith('\n') ? '\u200B' : null}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                // 回复与编辑时打开即可输入
                autoFocus={autoFocus}
                placeholder={placeholder || (isPrivate ? t('private_placeholder') : t('placeholder'))}
                aria-label={placeholder || t('placeholder')}
                // @ 候选列表展开时，读屏通过 activedescendant 得知当前选中的候选（焦点仍留在输入框）
                aria-autocomplete="list"
                aria-expanded={mention.open}
                aria-controls={mention.open ? mentionListId : undefined}
                aria-activedescendant={mention.open && mention.candidates.length > 0 ? mentionOptionId(mentionListId, mention.activeIndex) : undefined}
                className={cn(
                  'col-start-1 row-start-1 resize-none border-0 bg-transparent px-3 py-2 font-sans text-base leading-6 wrap-break-word shadow-none focus-visible:ring-0 md:text-sm md:leading-5 dark:bg-transparent',
                  expanded ? 'min-h-16' : 'min-h-10',
                  hasHighlight && 'overflow-hidden',
                  hasHighlight && !mention.composing && 'text-transparent caret-foreground selection:bg-primary/20 selection:text-transparent',
                )}
                value={commentContent}
                onChange={(e) => {
                  setCommentContent(e.target.value)
                  // 光标位置要等 React 更新完 value 才准
                  window.setTimeout(mention.syncFromCursor, 0)
                }}
                onCompositionStart={() => mention.setComposing(true)}
                onCompositionEnd={() => mention.setComposing(false)}
                // 点击、方向键移动光标后重新判断是否还在 @片段 里
                onClick={mention.syncFromCursor}
                onKeyUp={mention.syncFromCursor}
                // 粘贴截图、图片或文件时作为附件上传，文字照常粘贴
                onPaste={(e) => {
                  const files = pastedFilesOf(e.clipboardData)
                  if (files.length === 0)
                    return
                  e.preventDefault()
                  attachments.addFiles(withPastedFileNames(files))
                }}
                onKeyDown={(e) => {
                  // 提及候选展开时优先让上下键与回车选中候选（IME 组字期间内部直接放行）
                  if (mention.handleKeyDown(e))
                    return
                  if (!isComposingKey(e) && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleCommentSubmit()
                  }
                }}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={e => e.preventDefault()}
            onCloseAutoFocus={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl p-0 shadow-lg"
          >
            <MentionCandidates
              id={mentionListId}
              candidates={mention.candidates}
              activeIndex={mention.activeIndex}
              loading={mention.loading}
              isEmptyQuery={mention.isEmptyQuery}
              atLimit={mention.atLimit}
              mentionCount={mention.mentionCount}
              ownerId={ownerId}
              onPick={mention.select}
              onHover={mention.setActiveIndex}
            />
          </PopoverContent>
        </Popover>
        <CommentAttachmentList state={attachments} />
        {expanded && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            <CommentAttachmentButton state={attachments} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled={mention.atLimit}
              title={mention.atLimit ? t('mentions_max', { count: MAX_COMMENT_MENTIONS }) : t('mention_button_hint')}
              aria-label={t('mention_button')}
              onMouseDown={e => e.preventDefault()}
              onClick={mention.triggerMention}
              className={cn(
                'h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground max-sm:h-9 max-sm:px-3',
                mention.mentionCount > 0 && 'text-primary hover:text-primary',
                mention.atLimit && 'opacity-60',
              )}
            >
              <AtSign className="size-3.5" />
              {mention.mentionCount > 0 && <span className="tabular-nums">{`${mention.mentionCount}/${MAX_COMMENT_MENTIONS}`}</span>}
            </Button>
            <Toggle
              size="sm"
              variant="outline"
              pressed={isPrivate}
              onPressedChange={setIsPrivate}
              className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground max-sm:h-9 max-sm:px-3"
            >
              <Lock className="size-3.5" />
              {t('private')}
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={showClientInfo}
              onPressedChange={setShowClientInfo}
              className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground max-sm:h-9 max-sm:px-3"
            >
              <Monitor className="size-3.5" />
              {t('show_client_info')}
            </Toggle>
            <span className="flex-1" />
            <CommentLengthRing used={charCount} max={maxLength} />
            <Kbd className="hidden sm:inline-flex" title={t('submit_shortcut')}>{mac ? '⌘ ↵' : 'Ctrl ↵'}</Kbd>
            {onCancel && (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {operationT('cancel')}
              </Button>
            )}
            <Button type="button" size="sm" onClick={handleCommentSubmit} disabled={submitting || empty || tooLong || attachments.uploading || unchanged}>
              {submitting && <Loader2 className="animate-spin" />}
              {isUpdate ? operationT('update') : replyTo ? t('reply') : t('publish')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const noopSubscribe = () => () => {}

function detectMac() {
  return typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
}

/** 是否 macOS（快捷键提示显示 ⌘ 还是 Ctrl）；服务端渲染时按非 Mac，水合后再按实际平台 */
function useIsMac() {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false)
}

export interface CommentSubmitPayload {
  commentContent: string
  attachments: CommentAttachment[]
  isPrivate: boolean
  showClientInfo: boolean
  // 被 @ 的人（正文里仍是 @用户名），由后端校验后写库
  mentionUserIds: number[]
}

// 未登录时的登录邀请：后台已启用的第三方登录与快捷登录按钮，不再显示游客用不了的输入框和选项
function GuestInvite() {
  const t = useTranslations('Comment')
  const operationT = useOperationT()
  const openLogin = useLoginDialog()
  const pathname = usePathname()
  const { refresh } = useAuth()
  // 读取失败时只显示登录按钮
  const { providers } = useOidcProviders()

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 fade-in-up sm:flex-nowrap">
      <GuestAvatar />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('guest_title')}</p>
        <p className="text-sm text-muted-foreground">{t('guest_desc')}</p>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        {/* 第三方登录在小窗里完成，本页不离开（见 components/auth/oidc-popup.ts） */}
        <OidcProviderButtons
          providers={providers}
          redirectBack={pathname}
          variant="icon"
          mode="popup"
          onLoggedIn={() => refresh()}
        />
        <Button type="button" className="flex-1 sm:flex-none" onClick={() => openLogin({ reason: 'comment' })}>
          <LogIn />
          {operationT('login')}
        </Button>
      </div>
    </div>
  )
}
