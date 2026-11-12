'use client'

import type { ConfigValues } from './config-fields'
import type { ConfigItem } from '@/models/config'
import { PlugZapIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { reindexSearch, testMeilisearch } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { formatDataSize } from '@/utils/common/datasize'

function isEnvBoolTrue(val?: string) {
  return !!val && ['1', 't', 'T', 'TRUE', 'true', 'True'].includes(val.trim())
}

/**
 * 搜索服务连接测试与全站索引重建：
 * - 测试连接：读取当前表单填写的地址与密钥（无需先保存；环境变量锁定项由后端读取生效配置）验证服务连通性与密钥权限
 * - 重建索引：对已保存生效的搜索服务触发全站公开资源（文章、页面、评论、候选用户）平滑重建
 */
export function SearchTestField({ items = [] }: { items?: ConfigItem[] }) {
  const t = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const { getValues, formState: { dirtyFields } } = useFormContext<ConfigValues>()
  const [testing, setTesting] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean, text: string } | null>(null)

  const byKey = new Map(items.map(item => [item.key, item]))
  const envUrl = byKey.get('meilisearch_url')?.envValue
  const envEnable = byKey.get('meilisearch_enable')?.envValue
  const envKey = byKey.get('meilisearch_api_key')?.envValue
  const envPrefix = byKey.get('meilisearch_index_prefix')?.envValue

  const watchedUrl = String(useWatch<ConfigValues>({ name: 'meilisearch_url' }) ?? '').trim()
  const watchedEnable = Boolean(useWatch<ConfigValues>({ name: 'meilisearch_enable' }))

  const effectiveUrl = envUrl ? envUrl.trim() : watchedUrl
  const effectiveEnabled = envEnable ? isEnvBoolTrue(envEnable) : watchedEnable
  const dirty = dirtyFields as Record<string, unknown>
  const hasUnsavedSearchChanges = Boolean(
    dirty.meilisearch_enable || dirty.meilisearch_url || dirty.meilisearch_api_key || dirty.meilisearch_index_prefix,
  )

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      const res = await testMeilisearch({
        url: envUrl ? undefined : watchedUrl,
        apiKey: envKey ? undefined : String(getValues('meilisearch_api_key') ?? ''),
        indexPrefix: envPrefix ? undefined : String(getValues('meilisearch_index_prefix') ?? ''),
      })
      const text = t('search_test_success', {
        version: res.data.version || '-',
        location: res.data.location,
        size: formatDataSize({ size: res.data.databaseSize }),
      })
      setResult({ ok: true, text })
      toast.success(text)
    }
    catch (error) {
      const text = errorMessageT(error, t('search_test_failed'))
      setResult({ ok: false, text })
      toast.error(text)
    }
    finally {
      setTesting(false)
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    setResult(null)
    try {
      const res = await reindexSearch()
      const text = res.data.alreadyRunning ? t('search_reindex_running') : t('search_reindex_started')
      setResult({ ok: true, text })
      toast.success(text)
    }
    catch (error) {
      const text = errorMessageT(error, t('search_reindex_failed'))
      setResult({ ok: false, text })
      toast.error(text)
    }
    finally {
      setReindexing(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3 md:col-span-2">
      <div className="grid gap-1">
        <span className="text-sm leading-none font-medium">{t('search_test')}</span>
        <span className="text-xs text-muted-foreground">{t('search_test_desc')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={testing || reindexing || !effectiveUrl} onClick={() => void handleTest()}>
          {testing ? <Spinner /> : <PlugZapIcon />}
          {testing ? t('search_test_testing') : t('search_test_run')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing || reindexing || !effectiveEnabled || !effectiveUrl || hasUnsavedSearchChanges}
          onClick={() => void handleReindex()}
        >
          {reindexing ? <Spinner /> : <RefreshCwIcon />}
          {t('search_reindex')}
        </Button>
      </div>
      {!effectiveUrl && <p className="text-xs text-muted-foreground">{t('search_test_missing_url')}</p>}
      {effectiveUrl && hasUnsavedSearchChanges && (
        <p className="text-xs text-muted-foreground">{t('search_reindex_save_first')}</p>
      )}
      {result && (
        <p role="status" className={cn('text-xs', result.ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive')}>
          {result.text}
        </p>
      )}
    </div>
  )
}
