'use client'

import type { NotificationDelivery } from '@/models/notification'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listNotificationDeliveries, retryNotificationDelivery } from '@/api/admin'
import { STICKY_ACTIONS_CLASS } from '@/components/console/common/sticky-actions'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useErrorMessageT } from '@/hooks/use-translations'

const PAGE_SIZE = 20

const STATES = [
  { value: 'attention', label: 'state_attention' },
  { value: 'failed', label: 'state_failed' },
  { value: 'pending', label: 'state_pending' },
  { value: 'sending', label: 'state_sending' },
  { value: 'sent', label: 'state_sent' },
  { value: 'skipped', label: 'state_skipped' },
] as const

/**
 * 通知邮件投递排查：管理员只能看到投递状态与错误原因，看不到别人的通知内容；
 * 失败的批次可以手动重试（重试后由 worker 在下一轮发出）
 */
export default function NotificationDeliveriesPage() {
  const t = useTranslations('NotificationDelivery')
  const globalT = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const [state, setState] = useState<string>('attention')
  const [rows, setRows] = useState<NotificationDelivery[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<number | null>(null)

  const load = useCallback(async (nextPage: number) => {
    setLoading(true)
    try {
      const res = await listNotificationDeliveries({
        // 「需要关注」不带 state，后端默认返回 failed + sending
        state: state === 'attention' ? undefined : state,
        page: nextPage,
        size: PAGE_SIZE,
      })
      setRows(res.data.deliveries)
      setTotal(res.data.total)
      setPage(nextPage)
    }
    catch (error) {
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [state, t, errorMessageT])

  useEffect(() => {
    void load(1)
  }, [load])

  const retry = async (id: number) => {
    setRetrying(id)
    try {
      await retryNotificationDelivery(id)
      toast.success(t('retry_success'))
      await load(page)
    }
    catch (error) {
      toast.error(`${t('retry_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setRetrying(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm text-balance">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATES.map(option => (
                <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => void load(page)}>
            <RefreshCw />
            <span className="sr-only">{globalT('refresh')}</span>
          </Button>
        </div>
      </div>

      {loading
        ? <Skeleton className="h-64 w-full rounded-xl" />
        : rows.length === 0
          ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>{t('empty_title')}</EmptyTitle>
                  <EmptyDescription>{t('empty_desc')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('col_recipient')}</TableHead>
                      <TableHead>{t('col_type')}</TableHead>
                      <TableHead>{t('col_state')}</TableHead>
                      <TableHead>{t('col_attempts')}</TableHead>
                      <TableHead>{t('col_error')}</TableHead>
                      <TableHead className={`text-right ${STICKY_ACTIONS_CLASS}`}>{t('col_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const typeKey = `types.${row.type.replace('.', '_')}`
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="max-w-48 truncate text-xs">{row.userEmail || `#${row.userId}`}</TableCell>
                          <TableCell className="text-xs">
                            <div>{t.has(typeKey) ? t(typeKey) : row.type}</div>
                            <div className="text-muted-foreground max-w-48 truncate">{row.subjectTitle}</div>
                          </TableCell>
                          <TableCell className="text-xs">{t(`state_${row.emailState}`)}</TableCell>
                          <TableCell className="text-xs tabular-nums">{row.attempts}</TableCell>
                          <TableCell className="text-muted-foreground max-w-64 truncate text-xs" title={row.lastError}>{row.lastError || '—'}</TableCell>
                          <TableCell className={`text-right ${STICKY_ACTIONS_CLASS}`}>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              // 后端只接受失败与超时未结束的发送中（sending 未超时时返回 409），待发 / 已跳过 / 已发送的没有可重试的
                              disabled={retrying === row.id || !(row.emailState === 'failed' || row.emailState === 'sending')}
                              onClick={() => void retry(row.id)}
                            >
                              {retrying === row.id && <Loader2 className="animate-spin" />}
                              {t('retry')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

      {totalPages > 1 && (
        <div className="text-muted-foreground flex items-center justify-end gap-2 text-xs">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => void load(page - 1)}>
            {t('prev')}
          </Button>
          <span className="tabular-nums">
            {page}
            {' '}
            /
            {' '}
            {totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => void load(page + 1)}>
            {t('next')}
          </Button>
        </div>
      )}
    </div>
  )
}
