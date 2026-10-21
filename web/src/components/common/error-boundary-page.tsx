'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 路由错误边界展示：提示出错并提供重试 / 返回首页
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

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="w-full flex-1 flex items-center justify-center pt-40">
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
      </div>
    </div>
  )
}
