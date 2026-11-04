'use client'

import type { AgentMemory, AgentMemoryKind } from '@/models/ai-agent'
import { Loader2, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react'
import { useFormatter } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { deleteAgentMemory, listAgentMemories, updateAgentMemory } from '@/api/ai-agent'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { AGENT_MEMORY_KINDS } from '@/models/ai-agent'
import { useAIAgentT } from './shared'

const ALL = 'all'
const COLUMN_COUNT = 6

export interface MemorySubject {
  id: number
  name: string
}

// 记忆浏览：情景记忆与里程碑，管理员可编辑内容、重要性、置顶或删除
export function AgentMemoriesPanel({ agentId, subject, onSubjectChange }: {
  agentId: number
  subject: MemorySubject | null // 按对象筛选（从关系列表跳转）
  onSubjectChange: (subject: MemorySubject | null) => void
}) {
  const t = useAIAgentT()
  const format = useFormatter()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [kind, setKind] = useState<AgentMemoryKind | typeof ALL>(ALL)
  const [queryInput, setQueryInput, query] = useDebouncedState('', 300)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AgentMemory | null>(null)

  const fetchMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listAgentMemories(agentId, {
        page,
        size,
        kind: kind === ALL ? '' : kind,
        subjectUserId: subject?.id,
        query: query.trim(),
      })
      setMemories(res.data.memories ?? [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [agentId, errorMessageT, kind, page, query, size, subject?.id])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  // 筛选条件变化时回到第一页
  const filterKey = `${kind}|${query}|${subject?.id ?? ''}`
  const prevFilterRef = useRef(filterKey)
  useEffect(() => {
    if (prevFilterRef.current === filterKey)
      return
    prevFilterRef.current = filterKey
    setPage(1)
  }, [filterKey])

  const togglePin = async (memory: AgentMemory) => {
    try {
      await updateAgentMemory(memory.id, { pinned: !memory.pinned })
      setMemories(list => list.map(item => (item.id === memory.id ? { ...item, pinned: !memory.pinned } : item)))
    }
    catch (err) {
      toast.error(errorMessageT(err, operationT('update_failed')))
    }
  }

  const handleDelete = async (memory: AgentMemory) => {
    await deleteAgentMemory(memory.id)
    toast.success(operationT('delete_success'))
    if (memories.length <= 1 && page > 1)
      setPage(page - 1)
    else
      await fetchMemories()
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={kind} onValueChange={v => setKind(v as AgentMemoryKind | typeof ALL)}>
            <TabsList>
              <TabsTrigger value={ALL}>{t('memories.all')}</TabsTrigger>
              {AGENT_MEMORY_KINDS.map(item => <TabsTrigger key={item} value={item}>{t(`memory_kind.${item}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {subject && (
            <Badge variant="secondary" className="gap-1">
              {t('memories.about', { name: subject.name })}
              <button type="button" aria-label={t('list.clear_filters')} className="cursor-pointer" onClick={() => onSubjectChange(null)}>
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </div>
        <Input
          className="w-full sm:w-56"
          type="search"
          placeholder={t('memories.search_placeholder')}
          aria-label={t('memories.search_placeholder')}
          value={queryInput}
          onChange={e => setQueryInput(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t('memories.col_time')}</TableHead>
              <TableHead>{t('memories.col_content')}</TableHead>
              <TableHead className="w-32">{t('memories.col_subject')}</TableHead>
              <TableHead className="w-24">{t('memories.col_importance')}</TableHead>
              <TableHead className="w-28">{t('memories.col_source')}</TableHead>
              <TableHead className="w-28 text-right">{t('list.col_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 4 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell colSpan={COLUMN_COUNT}><Skeleton className="h-6 w-full" /></TableCell>
              </TableRow>
            ))}
            {!loading && error && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center">
                  <div className="grid justify-items-center gap-3">
                    <p role="alert" className="text-sm text-destructive">{`${t('memories.load_failed')}: ${error}`}</p>
                    <Button size="sm" variant="outline" onClick={fetchMemories}>{t('retry')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && memories.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">{t('memories.empty')}</TableCell>
              </TableRow>
            )}
            {!loading && !error && memories.map(memory => (
              <TableRow key={memory.id}>
                <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                  <time dateTime={memory.createdAt} title={format.dateTime(new Date(memory.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}>
                    {format.relativeTime(new Date(memory.createdAt))}
                  </time>
                </TableCell>
                <TableCell className="max-w-xl align-top whitespace-normal">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={memory.kind === 'milestone' ? 'default' : 'outline'}>{t(`memory_kind.${memory.kind}`)}</Badge>
                      {memory.pinned && (
                        <Badge variant="secondary">
                          <Pin />
                          {t('memories.pinned')}
                        </Badge>
                      )}
                    </div>
                    <p className="break-words">{memory.content}</p>
                    {memory.expiresAt && !memory.pinned && (
                      <span className="text-xs text-muted-foreground">
                        {t('memories.expires_at', { time: format.dateTime(new Date(memory.expiresAt), { dateStyle: 'medium' }) })}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  {memory.subjectUserId
                    ? (
                        <button
                          type="button"
                          className="cursor-pointer truncate text-left hover:text-primary hover:underline"
                          onClick={() => onSubjectChange({ id: memory.subjectUserId!, name: memory.subjectName || `#${memory.subjectUserId}` })}
                        >
                          {memory.subjectName || `#${memory.subjectUserId}`}
                        </button>
                      )
                    : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="align-top tabular-nums">{memory.importance.toFixed(2)}</TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">
                  {memory.sourceRunId ? `run #${memory.sourceRunId}` : '-'}
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={memory.pinned ? t('memories.unpin') : t('memories.pin')}
                      title={memory.pinned ? t('memories.unpin') : t('memories.pin')}
                      onClick={() => togglePin(memory)}
                    >
                      {memory.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" aria-label={operationT('edit')} title={operationT('edit')} onClick={() => setEditing(memory)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Popconfirm
                      title={operationT('confirm_delete')}
                      description={operationT('delete_description')}
                      confirmText={operationT('delete')}
                      errorText={operationT('delete_failed')}
                      destructive
                      onConfirm={() => handleDelete(memory)}
                    >
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={operationT('delete')} title={operationT('delete')}>
                        <Trash2 className="size-4" />
                      </Button>
                    </Popconfirm>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {total > 0 && <PaginationController page={page} onPageChange={setPage} total={total} pageSize={size} />}
        <PageSizeSelector
          size={size}
          onSizeChange={(next) => {
            setSize(next)
            setPage(1)
          }}
        />
      </div>
      <EditMemoryDialog
        memory={editing}
        onOpenChange={open => !open && setEditing(null)}
        onSaved={(next) => {
          setMemories(list => list.map(item => (item.id === next.id ? next : item)))
          setEditing(null)
        }}
      />
    </div>
  )
}

interface MemoryForm {
  content: string
  importance: number
  pinned: boolean
}

function EditMemoryDialog({ memory, onOpenChange, onSaved }: {
  memory: AgentMemory | null
  onOpenChange: (open: boolean) => void
  onSaved: (memory: AgentMemory) => void
}) {
  const t = useAIAgentT()
  return (
    <Dialog open={Boolean(memory)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('memories.edit_title')}</DialogTitle>
          <DialogDescription>{t('memories.edit_description')}</DialogDescription>
        </DialogHeader>
        {memory && <EditMemoryFormBody memory={memory} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function EditMemoryFormBody({ memory, onCancel, onSaved }: { memory: AgentMemory, onCancel: () => void, onSaved: (memory: AgentMemory) => void }) {
  const t = useAIAgentT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const form = useForm<MemoryForm>({
    defaultValues: { content: memory.content, importance: memory.importance, pinned: memory.pinned },
  })

  const onSubmit = async (values: MemoryForm) => {
    const content = values.content.trim()
    try {
      await updateAgentMemory(memory.id, { content, importance: values.importance, pinned: values.pinned })
      toast.success(operationT('save_success'))
      onSaved({ ...memory, content, importance: values.importance, pinned: values.pinned })
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('save_failed')))
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="content"
          rules={{ validate: v => Boolean(v.trim()) || t('memories.content_required') }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('memories.col_content')}</FormLabel>
              <FormControl><Textarea {...field} rows={4} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="importance"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-3">
                <FormLabel>{t('memories.col_importance')}</FormLabel>
                <span className="text-sm text-muted-foreground tabular-nums">{field.value.toFixed(2)}</span>
              </div>
              <FormControl>
                <Slider min={0} max={1} step={0.05} value={[field.value]} onValueChange={([v]) => field.onChange(v)} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="pinned"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="grid gap-1">
                <FormLabel>{t('memories.pinned')}</FormLabel>
                <span className="text-xs text-muted-foreground">{t('memories.pinned_desc')}</span>
              </div>
              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {operationT('save')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
