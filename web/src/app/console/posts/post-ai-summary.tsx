'use client'
import type { Post } from '@/models/post'
import { AlertCircleIcon, Loader2Icon, RefreshCwIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { getAISummaryStatus, triggerAISummary } from '@/api/ai-summary'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useErrorMessageT } from '@/hooks/use-translations'
import { getErrorMessage } from '@/utils/common/error'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { consolePath } from '@/utils/common/route'

// 轮询间隔与允许的连续失败次数
const POLL_INTERVAL = 2000
const MAX_POLL_ERRORS = 3

type OnPostUpdate = ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void

/**
 * 单篇文章的 AI 摘要任务：触发生成，并在任务进行中轮询状态
 * 任务状态保存在列表中的 post 对象上（aiSummaryStatus），每行只有一个轮询，卸载时停止
 */
export function useAISummary({ post, onPostUpdate, canConfigure }: { post: Post, onPostUpdate: OnPostUpdate, canConfigure: boolean }) {
  const t = useTranslations('Console.post_manage_ai')
  const errorMessageT = useErrorMessageT()
  const router = useRouter()
  const running = post.aiSummaryStatus === 'running'
  const postId = post.id
  // 文案函数放进 ref，避免其引用变化导致轮询重启
  const tRef = useRef(t)
  const errorMessageTRef = useRef(errorMessageT)
  useEffect(() => {
    tRef.current = t
    errorMessageTRef.current = errorMessageT
  }, [t, errorMessageT])

  useEffect(() => {
    if (!running)
      return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let errors = 0
    const poll = async () => {
      try {
        const res = await getAISummaryStatus(postId)
        if (cancelled)
          return
        errors = 0
        const status = res.data
        if (status.status === 'running') {
          timer = setTimeout(poll, POLL_INTERVAL)
          return
        }
        if (status.status === 'succeeded') {
          onPostUpdate({
            post: {
              id: postId,
              description: status.description ?? '',
              descriptionByAi: true,
              aiSummaryStale: status.stale,
              aiSummaryAt: status.generatedAt ?? null,
              aiSummaryStatus: undefined,
              aiSummaryError: undefined,
            },
          })
          toast.success(tRef.current('success'))
        }
        else if (status.status === 'failed') {
          onPostUpdate({ post: { id: postId, aiSummaryStatus: 'failed', aiSummaryError: status.error } })
          toast.error(tRef.current('failed'), { description: status.error })
        }
        else {
          // idle：任务已不存在（如服务重启），清除进行中状态
          onPostUpdate({ post: { id: postId, aiSummaryStatus: undefined } })
        }
      }
      catch (error) {
        if (cancelled)
          return
        errors++
        if (errors < MAX_POLL_ERRORS) {
          timer = setTimeout(poll, POLL_INTERVAL)
          return
        }
        onPostUpdate({ post: { id: postId, aiSummaryStatus: undefined } })
        toast.error(`${tRef.current('status_failed')}: ${errorMessageTRef.current(error)}`)
      }
    }
    timer = setTimeout(poll, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [running, postId, onPostUpdate])

  const trigger = useCallback(() => {
    if (running)
      return
    triggerAISummary(postId)
      .then(() => {
        onPostUpdate({ post: { id: postId, aiSummaryStatus: 'running', aiSummaryError: undefined } })
        toast.info(t('started'))
      })
      .catch((error: unknown) => {
        const code = getErrorMessage(error)
        if (code === 'ai_summary_running') {
          // 已有任务在进行：直接进入轮询
          toast.info(t('already_running'))
          onPostUpdate({ post: { id: postId, aiSummaryStatus: 'running', aiSummaryError: undefined } })
          return
        }
        if (code === 'ai_not_configured') {
          // 只有管理员可以配置 AI，其他角色提示联系管理员
          toast.error(errorMessageT(error), canConfigure
            ? {
                description: t('not_configured_admin_hint'),
                action: { label: t('go_to_settings'), onClick: () => router.push(consolePath.global) },
              }
            : { description: t('not_configured_contact_admin') })
          return
        }
        toast.error(`${t('trigger_failed')}: ${errorMessageT(error)}`)
      })
  }, [running, postId, onPostUpdate, t, errorMessageT, canConfigure, router])

  return { running, failed: post.aiSummaryStatus === 'failed', trigger }
}

// 菜单项文案：生成过摘要则为“重新生成”
export function useAISummaryMenuLabel(post: Post) {
  const t = useTranslations('Console.post_manage_ai')
  return post.aiSummaryAt || post.descriptionByAi ? t('regenerate') : t('generate')
}

// 行内状态徽章：生成中 / 失败（可点击重试）/ 正文已更新提示
export function AISummaryBadges({ post, onRetry }: { post: Post, onRetry: () => void }) {
  const t = useTranslations('Console.post_manage_ai')
  if (post.aiSummaryStatus === 'running') {
    return (
      <Badge variant="secondary" className="text-xs" role="status">
        <Loader2Icon className="animate-spin" aria-hidden />
        {t('running')}
      </Badge>
    )
  }
  if (post.aiSummaryStatus === 'failed') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge asChild variant="outline" className="cursor-pointer border-destructive/40 text-xs text-destructive">
            <button type="button" onClick={onRetry}>
              <AlertCircleIcon aria-hidden />
              {t('failed_badge')}
            </button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          <div className="grid gap-1">
            {post.aiSummaryError && <span className="break-all">{post.aiSummaryError}</span>}
            <span className="opacity-80">{t('click_to_retry')}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }
  if (post.aiSummaryStale) {
    return (
      <Badge variant="outline" className="border-primary/30 bg-primary/5 text-xs text-primary">
        <RefreshCwIcon aria-hidden />
        {t('stale')}
      </Badge>
    )
  }
  return null
}

// 描述预览：单行截断，AI 生成的描述带 AI 标记
export function PostDescriptionLine({ post }: { post: Post }) {
  const t = useTranslations('Console.post_manage_ai')
  if (!post.description)
    return null
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {post.descriptionByAi && (
        <Badge variant="outline" className="px-1 py-0 text-[10px] text-primary" title={t('ai_marker_title')}>
          <SparklesIcon aria-hidden />
          {t('ai_marker')}
        </Badge>
      )}
      <span className="line-clamp-1 break-all">{stripInlineMarkdown(post.description)}</span>
    </div>
  )
}
