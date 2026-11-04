import { Loader2, Lock, LogIn, Monitor, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { useLoginDialog } from '@/components/auth/login-dialog'
import { OidcProviderButtons, useOidcProviders } from '@/components/auth/oidc-providers'
import { GuestAvatar, UserAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { useAuth } from '@/contexts/auth-context'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { getUserUrl } from '@/utils/common/route'

/**
 * 评论框：未登录时显示登录邀请卡片；登录后为带工具栏的输入框（私密、显示设备信息、⌘/Ctrl + Enter 发布）。
 * collapsible 时平时收起成一行，聚焦或有内容时展开工具栏；replyTo 时在框内显示「回复 @某人」
 */
export function CommentInput({
  onCommentSubmitted,
  initContent = '',
  initIsPrivate = false,
  placeholder = '',
  isUpdate = false,
  initShowClientInfo = true,
  collapsible = false,
  showAvatar = false,
  autoFocus = false,
  replyTo,
  onCancel,
}: {
  onCommentSubmitted: ({
    commentContent,
    isPrivate,
    showClientInfo,
  }: {
    commentContent: string
    isPrivate: boolean
    showClientInfo: boolean
  }) => Promise<void> // 失败时需 reject，以便保留输入内容
  initContent?: string
  initIsPrivate?: boolean
  placeholder?: string
  isUpdate?: boolean
  initShowClientInfo?: boolean
  collapsible?: boolean
  showAvatar?: boolean // 在输入框左侧显示当前用户头像（主评论框）
  autoFocus?: boolean
  replyTo?: string // 回复对象的名字
  onCancel?: () => void
}) {
  const { user } = useAuth()
  const t = useTranslations('Comment')
  const operationT = useOperationT()

  const [isPrivate, setIsPrivate] = useState(initIsPrivate)
  const [showClientInfo, setShowClientInfo] = useState(initShowClientInfo)
  const [commentContent, setCommentContent] = useState(initContent)
  const [submitting, setSubmitting] = useState(false) // 提交中，防止重复提交
  const [focused, setFocused] = useState(false)

  if (!user)
    return <GuestInvite />

  const expanded = !collapsible || focused || commentContent.trim() !== ''
  const unchanged = isUpdate && commentContent.trim() === initContent.trim() && isPrivate === initIsPrivate && showClientInfo === initShowClientInfo

  const handleCommentSubmit = async () => {
    if (submitting)
      return
    if (!commentContent.trim()) {
      toast.error(t('content_required'))
      return
    }
    if (unchanged) {
      toast.warning(t('comment_unchanged'))
      return
    }
    setSubmitting(true)
    try {
      await onCommentSubmitted({ commentContent, isPrivate, showClientInfo })
      // 仅在提交成功后清空，失败时保留用户输入
      setCommentContent('')
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
          href={getUserUrl(user)}
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
        // 焦点移到框内的按钮上时不收起
        onBlur={e => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
      >
        {replyTo && (
          <span className="mt-2 ml-2.5 inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2 text-xs text-secondary-foreground">
            {t('reply_to', { name: replyTo })}
            {onCancel && (
              <button type="button" onClick={onCancel} aria-label={t('cancel_reply')} className="rounded-full p-0.5 opacity-70 hover:opacity-100">
                <X className="size-3" />
              </button>
            )}
          </span>
        )}
        <Textarea
          // 回复与编辑时打开即可输入
          autoFocus={autoFocus}
          placeholder={placeholder || (isPrivate ? t('private_placeholder') : t('placeholder'))}
          aria-label={placeholder || t('placeholder')}
          className={cn('resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent', expanded ? 'min-h-16' : 'min-h-10')}
          value={commentContent}
          onChange={e => setCommentContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleCommentSubmit()
            }
          }}
        />
        {expanded && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            <Toggle
              size="sm"
              variant="outline"
              pressed={isPrivate}
              onPressedChange={setIsPrivate}
              className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
            >
              <Lock className="size-3.5" />
              {t('private')}
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={showClientInfo}
              onPressedChange={setShowClientInfo}
              className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
            >
              <Monitor className="size-3.5" />
              {t('show_client_info')}
            </Toggle>
            <span className="flex-1" />
            <Kbd className="hidden sm:inline-flex" title={t('submit_shortcut')}>⌘ ↵</Kbd>
            {onCancel && (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {operationT('cancel')}
              </Button>
            )}
            <Button type="button" size="sm" onClick={handleCommentSubmit} disabled={submitting || !commentContent.trim() || unchanged}>
              {submitting && <Loader2 className="animate-spin" />}
              {isUpdate ? operationT('update') : replyTo ? t('reply') : t('publish')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// 未登录时的登录邀请：后台已启用的第三方登录与快捷登录按钮，不再显示游客用不了的输入框和选项
function GuestInvite() {
  const t = useTranslations('Comment')
  const operationT = useOperationT()
  const openLogin = useLoginDialog()
  const pathname = usePathname()
  // 第三方登录完成后回到当前页面；读取失败时只显示登录按钮
  const { providers } = useOidcProviders({ redirectBack: pathname })

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 fade-in-up sm:flex-nowrap">
      <GuestAvatar />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('guest_title')}</p>
        <p className="text-sm text-muted-foreground">{t('guest_desc')}</p>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <OidcProviderButtons providers={providers} variant="icon" />
        <Button type="button" className="flex-1 sm:flex-none" onClick={() => openLogin({ reason: 'comment' })}>
          <LogIn />
          {operationT('login')}
        </Button>
      </div>
    </div>
  )
}
