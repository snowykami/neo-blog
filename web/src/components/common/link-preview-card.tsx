'use client'

import type { LinkPreviewTargetType } from '@/api/link-preview'
import type { LinkPreview } from '@/models/link-preview'
import { isAxiosError } from 'axios'
import { CircleAlertIcon, ExternalLinkIcon, GlobeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getLinkPreview } from '@/api/link-preview'
import { useLinkPreviewScope } from '@/components/common/link-preview-context'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'

// ready：抓取成功；basic：无预览权限场景只展示链接本身；failed：抓取失败
type PreviewResult
  = | { status: 'ready', preview: LinkPreview }
    | { status: 'basic' }
    | { status: 'failed' }

// 失败多为对方站点限流、超时等临时问题：失败结果只保留一小段时间，之后再打开卡片会重新请求
const FAILURE_RETRY_MS = 30_000

// 同一作用域下同一链接的预览只请求一次
const previewCache = new Map<string, Promise<PreviewResult>>()

function fetchLinkPreview(url: string, targetType?: LinkPreviewTargetType, targetId?: number) {
  const cacheKey = `${targetType ?? ''}:${targetId ?? ''}:${url}`
  let task = previewCache.get(cacheKey)
  if (!task) {
    task = getLinkPreview({ url, targetType, targetId })
      .then((preview): PreviewResult => ({ status: 'ready', preview }))
      .catch((err): PreviewResult => {
        const status = isAxiosError(err) ? err.response?.status : undefined
        return { status: status === 401 || status === 403 ? 'basic' : 'failed' }
      })
    task.then((result) => {
      if (result.status === 'failed')
        window.setTimeout(() => previewCache.delete(cacheKey), FAILURE_RETRY_MS)
    })
    previewCache.set(cacheKey, task)
  }
  return task
}

// 显示用的域名与完整地址：路径中的中文等字符解码后显示，去掉可能用来伪装地址的双向文本控制符
function describeUrl(url: string) {
  let display = url
  try {
    display = decodeURI(url)
  }
  catch {}
  display = display.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
  try {
    return { host: new URL(url).hostname, display }
  }
  catch {
    return { host: display, display }
  }
}

/**
 * 链接预览卡片：封面、标题、描述，以及始终可用的链接入口（域名 + 完整地址）与复制/打开操作。
 * 加载中、加载失败状态下同样可以直接打开链接（移动端点链接只会弹出卡片，不能只依赖预览成功）
 */
export function LinkPreviewCard({
  url,
  targetType: propTargetType,
  targetId: propTargetId,
  onOpen,
}: {
  url: string
  targetType?: LinkPreviewTargetType
  targetId?: number
  onOpen?: () => void
}) {
  const t = useTranslations('ContentCard')
  const operationT = useOperationT()
  const scope = useLinkPreviewScope()
  const targetType = propTargetType ?? scope.targetType
  const targetId = propTargetId ?? scope.targetId
  const requestKey = `${targetType ?? ''}:${targetId ?? ''}:${url}`
  const [result, setResult] = useState<{ key: string } & PreviewResult | null>(null)

  useEffect(() => {
    if (!url)
      return
    let cancelled = false
    fetchLinkPreview(url, targetType, targetId).then((next) => {
      if (!cancelled)
        setResult({ key: requestKey, ...next })
    })
    return () => {
      cancelled = true
    }
  }, [url, targetType, targetId, requestKey])

  // 切换链接后旧结果不再展示
  const state = result?.key === requestKey ? result : null
  const preview = state?.status === 'ready' ? state.preview : null
  const { host, display } = describeUrl(url)

  return (
    <div className="overflow-hidden cursor-default">
      {preview?.image && (
        <div className="relative h-32 bg-muted overflow-hidden">
          <SafeImage
            src={preview.image}
            alt={preview.title || host}
            width={320}
            height={128}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="grid gap-3 p-4">
        {/* 没有标题时（如图片直链）只显示下方的链接入口 */}
        {(preview?.title || preview?.description) && (
          <div className="grid gap-1 min-w-0">
            {preview.title && (
              <h3 className="font-semibold text-sm leading-tight line-clamp-2 break-words">
                {preview.title}
              </h3>
            )}
            {preview.description && (
              <p className="text-xs text-muted-foreground line-clamp-3 break-words">
                {preview.description}
              </p>
            )}
          </div>
        )}

        {!state && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            <span>{t('loading')}</span>
          </div>
        )}

        {state?.status === 'failed' && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlertIcon className="size-4 mt-0.5 shrink-0" />
            <span>{t('load_failed')}</span>
          </div>
        )}

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          className="grid gap-0.5 min-w-0 rounded-md bg-muted/60 px-3 py-2 transition-colors hover:bg-muted"
        >
          <span className="flex items-center gap-1.5 min-w-0 text-sm font-medium">
            {preview?.favicon
              ? (
                  <SafeImage
                    src={preview.favicon}
                    alt=""
                    width={16}
                    height={16}
                    className="size-4 shrink-0"
                    // 图标失效时显示通用图标
                    fallback={<GlobeIcon className="size-4 shrink-0 text-muted-foreground" />}
                  />
                )
              : <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{host}</span>
          </span>
          <span className="text-xs text-muted-foreground break-all line-clamp-2">{display}</span>
        </a>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              copyToClipboard(url)
              toast.success(operationT('copy_link_success'))
            }}
          >
            {operationT('copy_link')}
          </Button>
          <Button asChild size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
              <ExternalLinkIcon />
              {operationT('open')}
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
