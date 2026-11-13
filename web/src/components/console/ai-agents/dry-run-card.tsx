'use client'

import type { SearchSelectOption } from './shared'
import type { AgentRun } from '@/models/ai-agent'
import { FlaskConical, Info, Loader2, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { listPostsAdmin } from '@/api/admin'
import { dryRunAIAgent, getAgentRun, getAIAgentStats } from '@/api/ai-agent'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { RunDetailBody } from './run-list'
import { RunStatusBadge, SearchSelect, useAIAgentT } from './shared'

const POLL_INTERVAL = 2000
// 排队超过该时长仍未被领取时提示 Runner 可能不在线
const QUEUED_WARN_MS = 20000
const FINISHED = new Set<AgentRun['status']>(['done', 'failed', 'skipped'])

type TargetType = 'post' | 'comment'

interface DryRunFormValues {
  targetType: TargetType
  post: SearchSelectOption | null
  commentId: string
}

// 试运行：用指定文章或评论预演一次，只输出操作列表不执行
export function DryRunCard({ agentId }: { agentId: number }) {
  const t = useAIAgentT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const form = useForm<DryRunFormValues>({
    defaultValues: {
      targetType: 'post',
      post: null,
      commentId: '',
    },
  })
  const [targetType, post, commentId] = useWatch({
    control: form.control,
    name: ['targetType', 'post', 'commentId'],
  })
  const [run, setRun] = useState<AgentRun | null>(null)
  const [polling, setPolling] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [runnerOnline, setRunnerOnline] = useState<boolean | null>(null)

  useEffect(() => {
    getAIAgentStats().then(res => setRunnerOnline(res.data.runnerOnline)).catch(() => setRunnerOnline(null))
  }, [])

  const searchPosts = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const res = await listPostsAdmin({ page: 1, size: 20, query })
    return (res.data.posts ?? []).map(item => ({ value: item.id, label: item.title, description: `#${item.id}` }))
  }, [])

  // 轮询运行状态直到结束；卸载或停止时清理计时器
  const runId = run?.id
  useEffect(() => {
    if (!polling || !runId)
      return
    let cancelled = false
    let timer = 0
    const tick = async () => {
      try {
        const res = await getAgentRun(runId)
        if (cancelled)
          return
        setRun(res.data)
        setNow(Date.now())
        if (FINISHED.has(res.data.status)) {
          setPolling(false)
          return
        }
      }
      catch {
        // 单次请求失败时继续轮询，由用户决定是否停止
      }
      if (!cancelled)
        timer = window.setTimeout(tick, POLL_INTERVAL)
    }
    timer = window.setTimeout(tick, POLL_INTERVAL)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [polling, runId])

  const targetId = targetType === 'post' ? post?.value ?? 0 : Number(commentId)
  const canStart = Number.isInteger(targetId) && targetId > 0 && !starting && !polling

  const start = async (values: DryRunFormValues) => {
    const resolvedId = values.targetType === 'post' ? values.post?.value ?? 0 : Number(values.commentId)
    if (!Number.isInteger(resolvedId) || resolvedId <= 0 || starting || polling)
      return
    setPolling(false)
    setStarting(true)
    setRun(null)
    try {
      const res = await dryRunAIAgent(agentId, { targetType: values.targetType, targetId: resolvedId })
      setRun(res.data)
      const time = Date.now()
      setStartedAt(time)
      setNow(time)
      if (!FINISHED.has(res.data.status))
        setPolling(true)
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('operation_failed')))
    }
    finally {
      setStarting(false)
    }
  }

  const waitingTooLong = polling && run?.status === 'queued' && now - startedAt > QUEUED_WARN_MS

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-muted-foreground" />
          {t('dry_run.title')}
        </CardTitle>
        <CardDescription>{t('dry_run.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(start)}>
            <div className="grid gap-2">
              <FormField
                control={form.control}
                name="targetType"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <FormLabel>{t('dry_run.target')}</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        variant="segmented"
                        value={field.value}
                        onValueChange={v => v && field.onChange(v as TargetType)}
                        className="w-full"
                      >
                        <ToggleGroupItem value="post">{t('target_type.post')}</ToggleGroupItem>
                        <ToggleGroupItem value="comment">{t('target_type.comment')}</ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                  </FormItem>
                )}
              />
              {targetType === 'post'
                ? (
                    <FormField
                      control={form.control}
                      name="post"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <SearchSelect
                              className="w-full"
                              selected={field.value}
                              placeholder={t('dry_run.select_post')}
                              emptyText={t('dry_run.no_post')}
                              search={searchPosts}
                              onSelect={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )
                : (
                    <FormField
                      control={form.control}
                      name="commentId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              min={1}
                              placeholder={t('dry_run.comment_id')}
                              aria-label={t('dry_run.comment_id')}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
            </div>
            {runnerOnline === false && (
              <Alert>
                <Info />
                <AlertDescription>{t('dry_run.runner_offline')}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!canStart}>
                {starting ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                {t('dry_run.start')}
              </Button>
              {polling && (
                <Button type="button" variant="outline" onClick={() => setPolling(false)}>
                  <Square />
                  {t('dry_run.stop')}
                </Button>
              )}
              {run && <RunStatusBadge status={run.status} />}
            </div>
          </form>
        </Form>
        {waitingTooLong && (
          <Alert>
            <Info />
            <AlertDescription>{t('dry_run.waiting_long')}</AlertDescription>
          </Alert>
        )}
        {run && !polling && !FINISHED.has(run.status) && (
          <p className="text-sm text-muted-foreground">{t('dry_run.stopped', { id: run.id })}</p>
        )}
        {run && FINISHED.has(run.status) && (
          <div className="rounded-md border bg-muted/30 p-3">
            <RunDetailBody run={run} showRaw />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
