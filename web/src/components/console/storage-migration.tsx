'use client'

import type { StorageMigrationStatus, StorageProviderConfig, StorageProviderUsage } from '@/models/file'
import { Info, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { cancelStorageMigration, getStorageMigration, listStorageProviders, startStorageMigration } from '@/api/file'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { formatDataSize } from '@/utils/common/datasize'

// 运行中的迁移每隔该时长刷新一次进度
const POLL_INTERVAL = 1500

// isDirectStorage 配置了公开地址的 S3 由浏览器直连，其余存储经后端代理
export function isDirectStorage(storage: StorageProviderConfig) {
  return storage.type === 's3' && !!storage.s3BaseUrl
}

// useStorageMigration 最近一次迁移的进度：运行中时轮询，结束时调用 onFinished
export function useStorageMigration(onFinished?: () => void) {
  const [status, setStatus] = useState<StorageMigrationStatus | null>(null)
  const refresh = useCallback(async () => {
    try {
      const res = await getStorageMigration()
      setStatus(res.data.migration)
    }
    catch {
      // 轮询失败时保留上一次的进度，下一轮再试
    }
  }, [])
  const running = status?.state === 'running'

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!running)
      return
    const timer = setInterval(() => void refresh(), POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [running, refresh])

  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running)
      onFinishedRef.current?.()
    wasRunning.current = running
  }, [running])

  return { status, running, refresh }
}

interface MigrationForm {
  targetProviderId: string
}

// StorageMigrationDialog 迁移整个存储（source）或选中的文件（fileIds）到目标存储
export function StorageMigrationDialog({ open, onOpenChange, source, usage, fileIds, onStarted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source?: StorageProviderConfig
  usage?: StorageProviderUsage
  fileIds?: number[]
  onStarted: (status: StorageMigrationStatus) => void
}) {
  const t = useTranslations('Console.storages.migration')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {source
              ? t('description_provider', {
                  name: source.name,
                  files: usage?.files ?? 0,
                  size: formatDataSize({ size: usage?.bytes ?? 0 }),
                  pages: usage?.pageHtmlVersions ?? 0,
                })
              : t('description_files', { n: fileIds?.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        {open && <MigrationFormBody source={source} fileIds={fileIds} onCancel={() => onOpenChange(false)} onStarted={onStarted} />}
      </DialogContent>
    </Dialog>
  )
}

function MigrationFormBody({ source, fileIds, onCancel, onStarted }: {
  source?: StorageProviderConfig
  fileIds?: number[]
  onCancel: () => void
  onStarted: (status: StorageMigrationStatus) => void
}) {
  const t = useTranslations('Console.storages.migration')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [providers, setProviders] = useState<StorageProviderConfig[]>([])
  const form = useForm<MigrationForm>({ defaultValues: { targetProviderId: '' } })
  const targetId = form.watch('targetProviderId')
  const target = providers.find(p => String(p.id) === targetId)

  useEffect(() => {
    listStorageProviders()
      .then(res => setProviders((res.data.providers ?? []).filter(p => p.id !== source?.id)))
      .catch(error => toast.error(errorMessageT(error)))
  }, [source?.id, errorMessageT])

  const onSubmit = async (values: MigrationForm) => {
    try {
      const res = await startStorageMigration({
        targetProviderId: Number(values.targetProviderId),
        sourceProviderId: source?.id,
        fileIds,
      })
      toast.success(t('started'))
      onStarted(res.data)
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('operation_failed')))
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="targetProviderId"
          rules={{ required: t('target_required') }}
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{t('target')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('select_target')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                      <span className="text-xs text-muted-foreground">
                        {p.type}
                        {' · '}
                        {isDirectStorage(p) ? t('direct') : t('proxy')}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <Alert>
          <Info />
          <AlertDescription>
            {target && isDirectStorage(target) ? t('hint_direct') : t('hint_proxy')}
            {' '}
            {t('hint_keep_source')}
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {t('start')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

const STATE_VARIANTS: Record<StorageMigrationStatus['state'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  done: 'secondary',
  failed: 'destructive',
  canceled: 'outline',
  interrupted: 'destructive',
}

// StorageMigrationProgress 迁移进度卡片：运行中可取消，结束后显示结果与最近的错误
export function StorageMigrationProgress({ status, providers, onChange }: {
  status: StorageMigrationStatus
  providers: StorageProviderConfig[]
  onChange: () => void
}) {
  const t = useTranslations('Console.storages.migration')
  const errorMessageT = useErrorMessageT()
  const [canceling, setCanceling] = useState(false)
  const nameOf = (id: number) => providers.find(p => p.id === id)?.name ?? `#${id}`
  const total = status.objects + status.pageHtmlVersions
  const done = status.done + status.pageHtmlDone
  const percent = status.state === 'done' ? 100 : total > 0 ? Math.floor((done / total) * 100) : 0

  const onCancel = async () => {
    setCanceling(true)
    try {
      await cancelStorageMigration()
      onChange()
    }
    catch (error) {
      toast.error(errorMessageT(error))
    }
    finally {
      setCanceling(false)
    }
  }

  return (
    <Card className="mb-4 gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {t('progress_title')}
          <Badge variant={STATE_VARIANTS[status.state]}>{t(`state.${status.state}`)}</Badge>
        </CardTitle>
        <CardDescription>
          {status.sourceProviderId
            ? t('route_provider', { source: nameOf(status.sourceProviderId), target: nameOf(status.targetProviderId) })
            : t('route_files', { n: status.fileCount, target: nameOf(status.targetProviderId) })}
        </CardDescription>
        {status.state === 'running' && (
          <CardAction>
            <Button size="sm" variant="outline" disabled={canceling} onClick={onCancel}>
              {canceling && <Loader2 className="animate-spin" />}
              {t('cancel')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 px-4">
        <Progress value={percent} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {status.state === 'running' && <span>{t(`phase.${status.phase}`)}</span>}
          <span>{t('objects', { done: status.done, total: status.objects })}</span>
          <span>{t('bytes', { done: formatDataSize({ size: status.bytes }), total: formatDataSize({ size: status.totalBytes }) })}</span>
          <span>{t('copied', { n: status.copied })}</span>
          {status.pageHtmlVersions > 0 && <span>{t('pages', { done: status.pageHtmlDone, total: status.pageHtmlVersions })}</span>}
          {status.linksUpdated > 0 && <span>{t('links_updated', { n: status.linksUpdated })}</span>}
          {status.failed > 0 && <span className="text-destructive">{t('failed', { n: status.failed })}</span>}
        </div>
        {(status.state === 'interrupted' || status.state === 'failed' || status.state === 'canceled') && (
          <p className="text-xs text-muted-foreground">{t('resume_hint')}</p>
        )}
        {status.errors.length > 0 && (
          <ul className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
            {status.errors.map((error, i) => <li key={i} className="break-all">{error}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
