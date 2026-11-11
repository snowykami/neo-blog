'use client'

import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Link } from '@/i18n/navigation'
import copyToClipboard from '@/lib/clipboard'
import { captureBoundaryError } from '@/lib/telemetry/client'
import { isChunkLoadError, isNewVersionDeployed, reloadForChunkError } from '@/utils/client/chunk-error'

// 复制后按钮显示「已复制」的时长
const COPIED_MS = 2000

/**
 * 错误详情：错误信息与调用栈，附上报告编号、页面地址、浏览器与时间，方便读者在手机上复制后反馈（手机上没有开发者工具）。
 * 只在展开时渲染（折叠内容收起时不挂载），只在浏览器中读取地址与浏览器信息
 */
function errorDetails(error: Error & { digest?: string }, reportId: string | null) {
  const summary = `${error.name}: ${error.message}`
  // Chromium 的调用栈第一行就是错误信息，去掉重复（Safari 的调用栈只有各帧）
  const stack = error.stack?.startsWith(summary) ? error.stack.slice(summary.length).replace(/^\n/, '') : error.stack
  return [
    summary,
    reportId && `report: ${reportId}`,
    error.digest && `digest: ${error.digest}`,
    `url: ${location.href}`,
    `ua: ${navigator.userAgent}`,
    `time: ${new Date().toISOString()}`,
    stack && `\n${stack}`,
  ].filter(Boolean).join('\n')
}

function ErrorDetails({ error, reportId }: { error: Error & { digest?: string }, reportId: string | null }) {
  const t = useTranslations('ErrorPage')
  const [details] = useState(() => errorDetails(error, reportId))
  const [copied, setCopied] = useState<boolean | null>(null)

  useEffect(() => {
    if (copied == null)
      return
    const timer = window.setTimeout(setCopied, COPIED_MS, null)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="grid gap-2 text-left">
      <p className="text-xs text-muted-foreground">{t('details_hint')}</p>
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-all select-text">{details}</pre>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => copyToClipboard(details).then(setCopied)}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t('copied') : copied === false ? t('copy_failed') : t('copy')}
        </Button>
      </div>
    </div>
  )
}

/**
 * 路由错误边界展示：提示出错并提供重试 / 返回首页，可展开查看错误详情
 */
export function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('ErrorPage')
  const operationT = useTranslations('Operation')
  // 错误报告的事件 ID：显示在错误详情里，读者反馈时据此在控制台找到这次错误
  const [reportId, setReportId] = useState<string | null>(null)

  useEffect(() => {
    console.error(error)
    // 新版本部署后旧页面加载代码块失败：刷新一次即可恢复，不上报
    if (isChunkLoadError(error)) {
      reloadForChunkError()
      return
    }
    // 滚动更新期间旧页面混进了新版本的代码（版本错位），会出现「xx is not a function」这类与代码本身无关的错误：
    // 服务器上已经是新版本时按版本错位处理，刷新一次加载新版本，不上报；冷却期内已刷新过（新版本本身有问题）时照常上报
    let cancelled = false
    void isNewVersionDeployed().then((deployed) => {
      if (cancelled || (deployed && reloadForChunkError()))
        return
      setReportId(captureBoundaryError(error))
    })
    return () => {
      cancelled = true
    }
  }, [error])

  return (
    <div className="flex w-full flex-1 items-center justify-center py-24">
      <div className="text-center max-w-xl w-full px-4">
        <h1 className="text-4xl font-bold mb-4">{t('title')}</h1>
        <p className="text-muted-foreground mb-2">{t('description')}</p>
        {error.digest && (
          <p className="text-xs text-muted-foreground mb-6 font-mono">
            {t('digest', { digest: error.digest })}
          </p>
        )}
        <div className="flex gap-3 justify-center mt-6">
          <Button onClick={() => reset()}>{t('retry')}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{operationT('back_to_home')}</Link>
          </Button>
        </div>
        <Collapsible className="grid gap-2 mt-6">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group justify-self-center text-muted-foreground">
              {t('details')}
              <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ErrorDetails key={reportId} error={error} reportId={reportId} />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
