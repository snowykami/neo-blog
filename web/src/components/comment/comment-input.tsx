import { CircleUser, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useToLogin } from '@/hooks/use-route'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getUserUrl } from '@/utils/common/route'
import { getFirstCharFromUser } from '@/utils/common/username'
import { Button } from '../ui/button'

export function CommentInput({
  onCommentSubmitted,
  initContent = '',
  initIsPrivate = false,
  placeholder = '',
  isUpdate = false,
  initShowClientInfo = true,
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
}) {
  const { user } = useAuth()
  const t = useTranslations('Comment')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const clickToLogin = useToLogin()

  const [isPrivate, setIsPrivate] = useState(initIsPrivate)
  const [showClientInfo, setShowClientInfo] = useState(initShowClientInfo)
  const [commentContent, setCommentContent] = useState(initContent)
  const [submitting, setSubmitting] = useState(false) // 提交中，防止重复提交

  const handleCommentSubmit = async () => {
    if (submitting)
      return
    if (!user) {
      // 通知
      toast.error(t('login_required'), {
        action: {
          label: operationT('login'),
          onClick: clickToLogin,
        },
      })
      return
    }
    if (!commentContent.trim()) {
      toast.error(t('content_required'))
      return
    }
    if (
      initContent === commentContent.trim()
      && initIsPrivate === isPrivate
      && initShowClientInfo === showClientInfo
    ) {
      toast.warning(t('comment_unchanged'))
      return
    }
    setSubmitting(true)
    try {
      await onCommentSubmitted({ commentContent, isPrivate, showClientInfo })
      // 仅在提交成功后清空，失败时保留用户输入
      setCommentContent('')
    }
    catch {
      // 错误提示由调用方负责
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fade-in-up">
      <div className="flex py-4 fade-in">
        {user
          ? (
              <Link
                href={getUserUrl(user)}
                aria-label={t('view_user_profile', { name: user.nickname || user.username })}
                className="cursor-pointer flex-shrink-0 w-10 h-10 fade-in"
              >
                <Avatar className="h-full w-full rounded-full">
                  <AvatarImage
                    src={getAvatarOrGravatarUrlFromUser({ user, size: 120 })}
                    alt={user.nickname}
                  />
                  <AvatarFallback className="rounded-full">{getFirstCharFromUser(user)}</AvatarFallback>
                </Avatar>
              </Link>
            )
          : (
              <button
                type="button"
                onClick={clickToLogin}
                aria-label={operationT('login')}
                className="cursor-pointer flex-shrink-0 w-10 h-10 fade-in"
              >
                <CircleUser className="w-full h-full fade-in" />
              </button>
            )}
        <div className="flex-1 pl-2 fade-in-up">
          <Textarea
            placeholder={
              placeholder
              || (user
                ? isPrivate
                  ? t('private_placeholder')
                  : t('placeholder')
                : commonT('login_required'))
            }
            className="w-full fade-in-up"
            value={commentContent}
            onChange={e => setCommentContent(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end fade-in-up space-x-4 items-center">
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={showClientInfo}
            onCheckedChange={checked => setShowClientInfo(checked === true)}
          />
          <Label onClick={() => setShowClientInfo(prev => !prev)}>{t('show_client_info')}</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={isPrivate}
            onCheckedChange={checked => setIsPrivate(checked === true)}
          />
          <Label onClick={() => setIsPrivate(prev => !prev)}>{t('private')}</Label>
        </div>
        <Button size="sm" onClick={handleCommentSubmit} disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {isUpdate ? operationT('update') : operationT('submit')}
        </Button>
      </div>
    </div>
  )
}
