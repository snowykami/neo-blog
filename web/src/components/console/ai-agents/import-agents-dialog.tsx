'use client'

import type { AIAgentFileItem, ImportAIAgentResult } from '@/models/ai-agent'
import { CircleCheck, FileJson, Loader2, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { importAIAgents } from '@/api/ai-agent'
import { UserAvatar } from '@/components/common/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommonT, useErrorBodyT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { AI_AGENT_TIERS } from '@/models/ai-agent'
import { consolePath } from '@/utils/common/route'
import { parseAgentFile } from './agent-file'
import { isValidAIUsername, USERNAME_MAX } from './create-agent-dialog'
import { TierBadge, useAIAgentT } from './shared'

const FILE_ACCEPT = '.json,application/json'
const FILE_PLACEHOLDER = '{"username": "...", "nickname": "...", "profile": {...}}\n[{"username": "..."}, {"username": "..."}]'

interface ImportRow {
  item: AIAgentFileItem
  username: string // 可在导入前修改：用户名决定新建还是更新已有的同名 AI 用户
}

interface ImportForm {
  agents: ImportRow[]
}

// 每一行的状态，按 useFieldArray 的行 id 记录：试运行得到将执行的操作或失败原因，导入后标记 done
interface RowState {
  action?: 'create' | 'update'
  agentId?: number
  done?: boolean
  error?: string
}

// 导入 AI 用户：读取导出文件或 AI 生成的文件（单个对象或数组），试运行预览每一项新建还是更新，再逐个导入
export function ImportAgentsDialog({ open, onOpenChange, onImported, onShowDistill }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (agentIds: number[], done: boolean) => void
  onShowDistill: () => void // 打开「人物蒸馏」说明
}) {
  const t = useAIAgentT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>
        {open && <ImportAgentsBody onCancel={() => onOpenChange(false)} onImported={onImported} onShowDistill={onShowDistill} />}
      </DialogContent>
    </Dialog>
  )
}

function ImportAgentsBody({ onCancel, onImported, onShowDistill }: {
  onCancel: () => void
  onImported: (agentIds: number[], done: boolean) => void
  onShowDistill: () => void
}) {
  const t = useAIAgentT()
  const commonT = useCommonT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const errorBodyT = useErrorBodyT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [content, setContent] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [checking, setChecking] = useState(false)
  const [checkToken, setCheckToken] = useState(0)
  const form = useForm<ImportForm>({ defaultValues: { agents: [] } })
  const { fields, replace, remove } = useFieldArray({ control: form.control, name: 'agents' })
  const pendingCount = fields.filter(field => !rows[field.id]?.done).length

  // 试运行在渲染之后读取最新的行与状态
  const latest = useRef({ fields, rows })
  useEffect(() => {
    latest.current = { fields, rows }
  })
  const checkSeq = useRef(0)

  // 尚未导入的行，带上可能修改过的用户名
  const pendingRows = useCallback(() => {
    const values = form.getValues('agents')
    return latest.current.fields
      .map((field, i) => ({ id: field.id, item: { ...values[i].item, username: values[i].username.trim() } }))
      .filter(row => !latest.current.rows[row.id]?.done)
  }, [form])

  const toState = useCallback((result: ImportAIAgentResult): RowState => result.error
    ? { error: errorBodyT(result.error, operationT('create_failed')) }
    : { action: result.action, agentId: result.agentId }, [errorBodyT, operationT])

  // 试运行：每一项将新建还是更新已有的同名 AI 用户，或者会因为什么失败；只采用最后一次的结果
  const check = useCallback(async () => {
    const seq = ++checkSeq.current
    const pending = pendingRows()
    if (pending.length === 0)
      return
    setChecking(true)
    try {
      const res = await importAIAgents(pending.map(row => row.item), true)
      if (seq !== checkSeq.current)
        return
      setRows((prev) => {
        const next = { ...prev }
        for (const result of res.data.results ?? []) {
          const row = pending[result.index]
          if (row && !next[row.id]?.done)
            next[row.id] = toState(result)
        }
        return next
      })
    }
    catch (error) {
      if (seq === checkSeq.current)
        toast.error(errorMessageT(error, operationT('operation_failed')))
    }
    finally {
      if (seq === checkSeq.current)
        setChecking(false)
    }
  }, [errorMessageT, operationT, pendingRows, toState])

  useEffect(() => {
    if (checkToken > 0)
      void check()
  }, [check, checkToken])

  const load = (value: string) => {
    const agents = parseAgentFile(value)
    if (!agents) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setRows({})
    replace(agents.map(item => ({ item, username: item.username })))
    setCheckToken(n => n + 1)
  }

  const readFile = async (file: File | undefined) => {
    if (!file)
      return
    const value = await file.text()
    setContent(value)
    load(value)
  }

  const onSubmit = async () => {
    checkSeq.current++ // 丢弃进行中的试运行结果
    setChecking(false)
    const pending = pendingRows()
    try {
      const res = await importAIAgents(pending.map(row => row.item))
      const next = { ...rows }
      const agentIds: number[] = []
      let created = 0
      let updated = 0
      for (const result of res.data.results ?? []) {
        const row = pending[result.index]
        if (!row)
          continue
        next[row.id] = { ...toState(result), done: !result.error }
        if (result.error || !result.agentId)
          continue
        agentIds.push(result.agentId)
        if (result.action === 'update')
          updated++
        else
          created++
      }
      setRows(next)
      const failed = pending.length - agentIds.length
      if (failed === 0)
        toast.success(t('import.success', { created, updated }))
      else
        toast.warning(t('import.partial', { created, updated, failed }))
      if (agentIds.length > 0 || failed === 0)
        onImported(agentIds, failed === 0)
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('create_failed')))
    }
  }

  if (fields.length === 0) {
    return (
      <div className="grid gap-4">
        <div
          role="button"
          tabIndex={0}
          data-drag-over={dragOver}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void readFile(e.dataTransfer.files[0])
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-muted/40 px-6 py-6 text-center outline-none transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[drag-over=true]:border-primary data-[drag-over=true]:bg-primary/5"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileJson className="size-5" />
          </span>
          <span className="text-sm text-foreground/85">{t('import.dropzone')}</span>
          <span className="text-xs text-muted-foreground">{FILE_ACCEPT}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={FILE_ACCEPT}
          onChange={(e) => {
            void readFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="grid gap-2">
          <Label htmlFor="ai-agent-import-json">{t('import.paste_label')}</Label>
          <Textarea
            id="ai-agent-import-json"
            rows={6}
            className="max-h-64 font-mono text-xs"
            placeholder={FILE_PLACEHOLDER}
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setInvalid(false)
            }}
          />
          {invalid && <p role="alert" className="text-sm text-destructive">{t('import.invalid_file')}</p>}
        </div>
        <Alert>
          <Sparkles />
          <AlertDescription>
            <p>
              {t.rich('import.skill_hint', {
                link: chunks => <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={onShowDistill}>{chunks}</button>,
              })}
            </p>
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="button" disabled={!content.trim()} onClick={() => load(content)}>{t('import.read')}</Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
            {t('import.count', { count: fields.length })}
            {checking && <Loader2 className="size-3.5 animate-spin" aria-label={t('import.checking')} />}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={form.formState.isSubmitting}
            onClick={() => {
              checkSeq.current++
              setChecking(false)
              replace([])
              setRows({})
            }}
          >
            {t('import.reselect')}
          </Button>
        </div>
        <ul className="grid max-h-[55vh] gap-3 overflow-y-auto">
          {fields.map((field, index) => {
            const { item } = field
            const state = rows[field.id]
            const profile = item.profile ?? {}
            return (
              <li key={field.id} className="grid gap-3 rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <UserAvatar user={{ username: item.username, nickname: item.nickname, avatarUrl: item.avatarUrl, gravatarHash: '' }} size={64} className="size-9" fallbackClassName="text-xs" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{item.nickname || item.username}</span>
                      {AI_AGENT_TIERS.includes(item.tier) && <TierBadge tier={item.tier} />}
                      {!state?.done && state?.action && (
                        <Badge variant={state.action === 'update' ? 'secondary' : 'outline'}>{t(`import.action_${state.action}`)}</Badge>
                      )}
                      {profile.archetype && <span className="truncate text-xs text-muted-foreground">{profile.archetype}</span>}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{profile.persona || t('import.no_persona')}</p>
                  </div>
                  {state?.done && state.agentId
                    ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`${consolePath.aiAgent}/${state.agentId}`}>
                            <CircleCheck className="text-primary" />
                            {t(state.action === 'update' ? 'import.updated' : 'import.imported')}
                          </Link>
                        </Button>
                      )
                    : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t('import.remove')}
                          title={t('import.remove')}
                          disabled={form.formState.isSubmitting}
                          onClick={() => remove(index)}
                        >
                          <X />
                        </Button>
                      )}
                </div>
                {!state?.done && (
                  <FormField
                    control={form.control}
                    name={`agents.${index}.username`}
                    rules={{
                      validate: (v: string, values) => {
                        const value = v.trim()
                        if (!value)
                          return t('create.required', { field: commonT('username') })
                        if (!isValidAIUsername(value))
                          return t('create.invalid_username', { max: USERNAME_MAX })
                        if (values.agents.filter(row => row.username.trim() === value).length > 1)
                          return t('import.duplicate_username')
                        return true
                      },
                    }}
                    render={({ field: input }) => (
                      <FormItem className="grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
                        <FormLabel className="text-xs text-muted-foreground">{commonT('username')}</FormLabel>
                        <FormControl>
                          <Input
                            {...input}
                            autoComplete="off"
                            className="h-8"
                            onChange={(e) => {
                              input.onChange(e)
                              // 用户名决定新建还是更新，改了之后上次的检查结果不再适用，离开输入框时重新检查
                              if (state)
                                setRows(({ [field.id]: _, ...rest }) => rest)
                            }}
                            onBlur={() => {
                              input.onBlur()
                              if (!state)
                                setCheckToken(n => n + 1)
                            }}
                          />
                        </FormControl>
                        <FormMessage className="col-start-2" />
                      </FormItem>
                    )}
                  />
                )}
                {!state?.done && state?.action === 'update' && <p className="text-xs text-muted-foreground">{t('import.update_hint')}</p>}
                {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{t('import.close')}</Button>
          <Button type="submit" disabled={pendingCount === 0 || form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {t('import.submit', { count: pendingCount })}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
