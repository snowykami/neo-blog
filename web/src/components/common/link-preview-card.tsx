'use client'

import type { LinkPreview } from '@/app/api/get-link-info/route'
import { ExternalLinkIcon, Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SafeImage } from '@/components/common/safe-image'
import { useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'

// 同一链接的预览只请求一次，失败记为 null
const previewCache = new Map<string, Promise<LinkPreview | null>>()

function getBasicPreview(url: string): LinkPreview | null {
  try {
    const { hostname } = new URL(url)
    return { title: hostname, description: '', url, siteName: hostname }
  }
  catch {
    return null
  }
}

function fetchLinkPreview(url: string) {
  let task = previewCache.get(url)
  if (!task) {
    task = fetch(`/api/get-link-info?url=${encodeURIComponent(url)}`)
      .then((response) => {
        if (response.ok)
          return response.json() as Promise<LinkPreview>
        // 预览接口仅登录用户可用，访客降级为只展示链接本身
        if (response.status === 401)
          return getBasicPreview(url)
        return null
      })
      .catch(() => null)
    previewCache.set(url, task)
  }
  return task
}

/**
 * 链接预览卡片内容：封面、标题、描述、站点，以及复制/打开操作
 */
export function LinkPreviewCard({ url, onOpen }: { url: string, onOpen?: () => void }) {
  const t = useTranslations('ContentCard')
  const operationT = useOperationT()
  const [result, setResult] = useState<{ url: string, preview: LinkPreview | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLinkPreview(url).then((preview) => {
      if (!cancelled)
        setResult({ url, preview })
    })
    return () => {
      cancelled = true
    }
  }, [url])

  // 切换链接后旧结果不再展示
  if (!result || result.url !== url) {
    return (
      <div className="p-4 flex items-center gap-3">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  const { preview } = result
  if (!preview) {
    return (
      <div className="p-4 flex items-center gap-3">
        <Globe className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground truncate">{t('load_failed')}</span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden cursor-default">
      {preview.image && (
        <div className="relative h-32 bg-muted rounded-t-md overflow-hidden">
          <SafeImage
            src={preview.image}
            alt={preview.title}
            width={320}
            height={128}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          {preview.favicon && (
            <SafeImage
              src={preview.favicon}
              alt=""
              width={16}
              height={16}
              className="w-4 h-4 mt-0.5 flex-shrink-0"
              // 图标失效时直接不显示
              fallback={null}
            />
          )}

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm leading-tight mb-1 line-clamp-2">
              {preview.title}
            </h3>

            {preview.description && (
              <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                {preview.description}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                <ExternalLinkIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  {preview.siteName || new URL(preview.url).hostname}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    copyToClipboard(preview.url)
                    toast.success(operationT('copy_link_success'))
                  }}
                  className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                  title={operationT('copy_link')}
                >
                  {operationT('copy_link')}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  onClick={onOpen}
                >
                  {operationT('open')}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
