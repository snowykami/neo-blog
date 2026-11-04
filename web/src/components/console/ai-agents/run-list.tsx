'use client'

import type { AgentAction, AgentEffect, AgentRun, AgentTraceStep } from '@/models/ai-agent'
import { ChevronDown, Undo2 } from 'lucide-react'
import { useFormatter } from 'next-intl'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getAgentRun, listAgentRuns, revertAgentRun } from '@/api/ai-agent'
import { UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { consolePath, getPostUrl } from '@/utils/common/route'
import { RunStatusBadge, triggerKey, useAIAgentT, useCompactNumber } from './shared'

export interface AgentRunFilters {
  agentId?: number
  status?: AgentRun['status'] | ''
  action?: 'comment' | 'like' | 'profile' | 'none' | ''
  trigger?: AgentRun['trigger'] | ''
}

// 评论与资料修改可以撤回；点赞不撤回
function revertible(run: AgentRun) {
  return !run.reverted && run.kind !== 'dry_run'
    && (run.effects ?? []).some(effect => (effect.type === 'comment' || effect.type === 'profile') && !effect.reverted)
}

// 运行记录列表：行为日志页与单个 AI 用户的「运行记录」共用；筛选与分页由调用方管理
export function AgentRunList({ filters, page, size, onPageChange, onSizeChange, showAgent = true, refreshKey = 0 }: {
  filters: AgentRunFilters
  page: number
  size: number
  onPageChange: (page: number) => void
  onSizeChange: (size: number) => void
  showAgent?: boolean
  refreshKey?: number
}) {
  const t = useAIAgentT()
  const errorMessageT = useErrorMessageT()
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { agentId, status, action, trigger } = filters

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listAgentRuns({ page, size, agentId: agentId || undefined, status: status || undefined, action: action || undefined, trigger: trigger || undefined })
      setRuns(res.data.runs ?? [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [action, agentId, errorMessageT, page, size, status, trigger])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns, refreshKey])

  // 撤回等操作后只刷新这一行
  const replaceRun = (next: AgentRun) => setRuns(list => list.map(run => (run.id === next.id ? next : run)))

  return (
    <div className="grid gap-4">
      <div className="text-sm text-muted-foreground tabular-nums">{t('runs.total', { total })}</div>
      <div className="rounded-md border">
        {loading && (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}
        {!loading && error && (
          <div className="grid justify-items-center gap-3 py-8">
            <p role="alert" className="text-sm text-destructive">{`${t('runs.load_failed')}: ${error}`}</p>
            <Button size="sm" variant="outline" onClick={fetchRuns}>{t('retry')}</Button>
          </div>
        )}
        {!loading && !error && runs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t('runs.empty')}</p>}
        {!loading && !error && runs.map((run, index) => (
          <div key={run.id}>
            {index > 0 && <Separator />}
            <RunRow run={run} showAgent={showAgent} onChanged={replaceRun} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {total > 0 && <PaginationController page={page} onPageChange={onPageChange} total={total} pageSize={size} />}
        <PageSizeSelector size={size} onSizeChange={onSizeChange} />
      </div>
    </div>
  )
}

// 一次运行的动作概要：无动作时显示「无视」
function ActionSummary({ run }: { run: AgentRun }) {
  const t = useAIAgentT()
  const actions = run.actions ?? []
  if (run.status !== 'done')
    return null
  if (actions.length === 0)
    return <Badge variant="secondary">{t('runs.ignored')}</Badge>
  const counts = new Map<string, number>()
  for (const action of actions)
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1)
  return (
    <>
      {[...counts].map(([type, count]) => (
        <Badge key={type} variant="secondary">
          {t(`action_type.${type}`)}
          {count > 1 && <span className="tabular-nums">{`×${count}`}</span>}
        </Badge>
      ))}
    </>
  )
}

// 运行目标：摘要行（位于展开按钮内）只显示文字，展开后的详情中文章标题可点击跳转
function RunTarget({ run, link = false }: { run: AgentRun, link?: boolean }) {
  const t = useAIAgentT()
  if (!run.targetType || !run.targetId)
    return <span className="text-muted-foreground">{t('runs.no_target')}</span>
  const title = run.targetTitle || `${t(`target_type.${run.targetType === 'comment' ? 'comment' : 'post'}`)} #${run.targetId}`
  if (link && run.targetType === 'post')
    return <Link href={getPostUrl({ post: { id: run.targetId } })} target="_blank" className="font-medium hover:text-primary hover:underline">{title}</Link>
  return <span className="font-medium">{title}</span>
}

export function RunRow({ run, showAgent = true, onChanged, defaultOpen = false }: {
  run: AgentRun
  showAgent?: boolean
  onChanged?: (run: AgentRun) => void
  defaultOpen?: boolean
}) {
  const t = useAIAgentT()
  const format = useFormatter()
  const compact = useCompactNumber()
  const [open, setOpen] = useState(defaultOpen)
  const time = new Date(run.createdAt)
  const tokens = run.promptTokens + run.completionTokens
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/50">
          <time dateTime={run.createdAt} title={format.dateTime(time, { dateStyle: 'medium', timeStyle: 'medium' })} className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
            {format.relativeTime(time)}
          </time>
          {showAgent && run.agent && (
            <span className="flex items-center gap-2 font-medium">
              <UserAvatar user={run.agent} size={48} className="size-6" fallbackClassName="text-xs" />
              {run.agent.nickname || run.agent.username}
            </span>
          )}
          <Badge variant="outline">{t(`trigger.${triggerKey(run.trigger)}`)}</Badge>
          <span className="min-w-0 flex-1 truncate">
            <RunTarget run={run} />
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <ActionSummary run={run} />
            {run.reverted && <Badge variant="secondary">{t('runs.reverted')}</Badge>}
            <RunStatusBadge status={run.status} />
          </span>
          <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{tokens > 0 ? compact(tokens) : '-'}</span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t bg-muted/30 px-4 py-3">
          <RunDetailBody run={run} onChanged={onChanged} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm break-words whitespace-pre-wrap">{children}</div>
    </div>
  )
}

// 一次运行的完整信息：操作列表、实际写入、原因、记忆笔记、用量、轨迹与错误
export function RunDetailBody({ run, onChanged, showRaw = false }: { run: AgentRun, onChanged?: (run: AgentRun) => void, showRaw?: boolean }) {
  const t = useAIAgentT()
  const operationT = useOperationT()
  const format = useFormatter()
  const [revertOpen, setRevertOpen] = useState(false)
  const actions = run.actions ?? []
  const effects = run.effects ?? []
  const trace = run.trace ?? []

  const handleRevert = async () => {
    await revertAgentRun(run.id)
    toast.success(t('runs.revert_success'))
    const res = await getAgentRun(run.id)
    onChanged?.(res.data)
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('runs.target')}><RunTarget run={run} link /></Field>
        <Field label={t('runs.kind')}>{t(`run_kind.${run.kind}`)}</Field>
        <Field label={t('runs.scheduled_at')}>{format.dateTime(new Date(run.scheduledAt), { dateStyle: 'short', timeStyle: 'medium' })}</Field>
        <Field label={t('runs.finished_at')}>{run.finishedAt ? format.dateTime(new Date(run.finishedAt), { dateStyle: 'short', timeStyle: 'medium' }) : '-'}</Field>
        <Field label={t('runs.model')}>{run.model || '-'}</Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>{t('runs.prompt_tokens', { count: run.promptTokens })}</span>
        <span>{t('runs.cached_tokens', { count: run.cachedTokens })}</span>
        <span>{t('runs.completion_tokens', { count: run.completionTokens })}</span>
        <span>{t('runs.llm_calls', { count: run.llmCalls })}</span>
      </div>
      {run.skipReason && <Field label={t('runs.skip_reason')}>{run.skipReason}</Field>}
      {run.error && (
        <Field label={t('runs.error')}>
          <span className="text-destructive">{run.error}</span>
        </Field>
      )}
      {run.reason && <Field label={t('runs.reason')}>{run.reason}</Field>}
      {run.memoryNote && <Field label={t('runs.memory_note')}>{run.memoryNote}</Field>}

      <div className="grid gap-2">
        <div className="text-xs text-muted-foreground">{t('runs.actions')}</div>
        {actions.length === 0
          ? <p className="text-sm text-muted-foreground">{run.status === 'done' ? t('runs.no_actions') : '-'}</p>
          : <ActionTable actions={actions} />}
      </div>

      {effects.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs text-muted-foreground">{t('runs.effects')}</div>
          <ul className="grid gap-1 text-sm">
            {effects.map((effect, i) => <EffectItem key={`${effect.type}-${i}`} effect={effect} />)}
          </ul>
        </div>
      )}

      {trace.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs text-muted-foreground">{t('runs.trace')}</div>
          <TraceTimeline trace={trace} />
        </div>
      )}

      {showRaw && actions.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs text-muted-foreground">{t('runs.raw_actions')}</div>
          <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">{JSON.stringify(actions, null, 2)}</pre>
        </div>
      )}

      {(revertible(run) || run.reverted || run.agentId > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {revertible(run) && (
            <Button size="sm" variant="destructive" onClick={() => setRevertOpen(true)}>
              <Undo2 />
              {t('runs.revert')}
            </Button>
          )}
          {run.reverted && <span className="text-sm text-muted-foreground">{t('runs.reverted_hint')}</span>}
          {run.agentId > 0 && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`${consolePath.aiAgent}/${run.agentId}`}>{t('runs.view_agent')}</Link>
            </Button>
          )}
        </div>
      )}
      {revertOpen && (
        <ConfirmDialog
          open
          title={t('runs.revert_title')}
          description={t('runs.revert_description')}
          confirmLabel={t('runs.revert')}
          errorText={operationT('operation_failed')}
          onOpenChange={setRevertOpen}
          onConfirm={handleRevert}
        />
      )}
    </div>
  )
}

function ActionTarget({ target }: { target?: string }) {
  if (!target)
    return <span className="text-muted-foreground">-</span>
  const [type, id] = target.split(':')
  if (type === 'post' && id)
    return <Link href={getPostUrl({ post: { id } })} target="_blank" className="font-mono text-xs hover:text-primary hover:underline">{target}</Link>
  return <span className="font-mono text-xs">{target}</span>
}

// 动作的内容：评论正文、点赞方向、资料修改的新值等
function ActionContent({ action }: { action: AgentAction }) {
  const t = useAIAgentT()
  if (action.type === 'like')
    return <span>{action.liked === false ? t('runs.unlike') : t('runs.like')}</span>
  if (action.type === 'update_profile') {
    return (
      <div className="grid gap-0.5">
        {action.nickname && <span>{t('runs.set_nickname', { value: action.nickname })}</span>}
        {action.preferredColor && (
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full border" style={{ backgroundColor: action.preferredColor }} aria-hidden="true" />
            {t('runs.set_color', { value: action.preferredColor })}
          </span>
        )}
      </div>
    )
  }
  if (action.type === 'set_avatar') {
    return (
      <div className="grid gap-0.5">
        <span>{t(`runs.image_kind.${action.kind === 'background' ? 'background' : 'avatar'}`)}</span>
        {action.imageUrl && <a href={action.imageUrl} target="_blank" rel="noreferrer noopener" className="truncate text-xs hover:text-primary hover:underline">{action.imageUrl}</a>}
        {(action.author || action.license || action.source) && (
          <span className="text-xs text-muted-foreground">{[action.author, action.license, action.source].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    )
  }
  return <span className="whitespace-pre-wrap break-words">{action.content || '-'}</span>
}

function ActionTable({ actions }: { actions: AgentAction[] }) {
  const t = useAIAgentT()
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{t('runs.col_type')}</TableHead>
            <TableHead className="w-32">{t('runs.col_target')}</TableHead>
            <TableHead>{t('runs.col_content')}</TableHead>
            <TableHead className="w-40">{t('runs.col_result')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action, i) => (
            <TableRow key={`${action.type}-${i}`}>
              <TableCell>{t(`action_type.${action.type}`)}</TableCell>
              <TableCell><ActionTarget target={action.target} /></TableCell>
              <TableCell className="max-w-md whitespace-normal"><ActionContent action={action} /></TableCell>
              <TableCell className="whitespace-normal">
                {action.result
                  ? (
                      <div className="grid gap-0.5">
                        <Badge variant={action.result === 'error' ? 'destructive' : action.result === 'ok' ? 'outline' : 'secondary'}>
                          {t.has(`action_result.${action.result}`) ? t(`action_result.${action.result}`) : action.result}
                        </Badge>
                        {action.commentId ? <span className="text-xs text-muted-foreground">{t('runs.comment_id', { id: action.commentId })}</span> : null}
                        {action.detail && <span className="text-xs text-muted-foreground">{action.detail}</span>}
                      </div>
                    )
                  : <span className="text-muted-foreground">-</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function EffectItem({ effect }: { effect: AgentEffect }) {
  const t = useAIAgentT()
  const typeLabel = t.has(`effect_type.${effect.type}`) ? t(`effect_type.${effect.type}`) : effect.type
  let text: string
  if (effect.type === 'comment')
    text = t('runs.effect_comment', { id: effect.commentId ?? 0 })
  else if (effect.type === 'like')
    text = t('runs.effect_like', { target: `${effect.targetType ?? ''}:${effect.targetId ?? ''}`, liked: String(Boolean(effect.liked)) })
  else
    text = t('runs.effect_profile', { field: effect.field ?? '', old: effect.old || '-', new: effect.new || '-' })
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{typeLabel}</Badge>
      <span className={cn('break-all', effect.reverted && 'text-muted-foreground line-through')}>{text}</span>
      {effect.reverted && <Badge variant="secondary">{t('runs.reverted')}</Badge>}
    </li>
  )
}

export function TraceTimeline({ trace }: { trace: AgentTraceStep[] }) {
  const format = useFormatter()
  return (
    <ol className="grid gap-1.5 border-l-2 pl-3 text-sm">
      {trace.map((step, i) => (
        <li key={`${step.at}-${i}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3">
          <time dateTime={step.at} className="font-mono text-xs text-muted-foreground tabular-nums">
            {format.dateTime(new Date(step.at), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </time>
          <span className="font-medium">{step.step}</span>
          <span className="break-words text-muted-foreground">{step.detail}</span>
        </li>
      ))}
    </ol>
  )
}
