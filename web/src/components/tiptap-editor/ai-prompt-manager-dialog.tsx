'use client'

import type { AIPrompt } from '@/models/ai-prompt'
import type { AIWriteMode } from '@/models/ai-write'
import { ArrowLeftIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createAIPrompt, deleteAIPrompt, updateAIPrompt } from '@/api/ai-prompt'
import { InfoTooltip, LabelWithInfo } from '@/components/common/info-tooltip'
import { Popconfirm } from '@/components/common/popconfirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { isAdmin } from '@/utils/common/permission'

// 与后端 aiPromptMaxLabelRune / aiPromptMaxInstructionRune 一致
const MAX_LABEL = 30
const MAX_INSTRUCTION = 1000

interface PromptFormValues {
  label: string
  instruction: string
  platform: boolean
}

/** AI 指令管理：平台指令由管理员增删改，编辑者管理自己的个人指令 */
export function AIPromptManagerDialog({ open, mode: initialMode, prompts, onOpenChange, onChanged }: {
  open: boolean
  mode: AIWriteMode
  prompts: AIPrompt[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const t = useTranslations('Console.editor.ai')
  const errorMessageT = useErrorMessageT()
  const { user } = useAuth()
  const admin = !!user && isAdmin({ user })
  const [mode, setMode] = React.useState<AIWriteMode>(initialMode)
  // 编辑视图：null 为列表，'new' 为新增，否则为正在编辑的指令
  const [editing, setEditing] = React.useState<AIPrompt | 'new' | null>(null)
  const form = useForm<PromptFormValues>({ defaultValues: { label: '', instruction: '', platform: false } })

  // 每次打开回到列表，并切换到打开时的模式
  React.useEffect(() => {
    if (open) {
      setMode(initialMode)
      setEditing(null)
    }
  }, [open, initialMode])

  const startEdit = (target: AIPrompt | 'new') => {
    form.reset(target === 'new'
      ? { label: '', instruction: '', platform: false }
      : { label: target.label, instruction: target.instruction, platform: target.scope === 'platform' })
    setEditing(target)
  }

  const onSubmit = async (values: PromptFormValues) => {
    const input = { mode, label: values.label.trim(), instruction: values.instruction.trim() }
    try {
      if (editing === 'new')
        await createAIPrompt({ ...input, scope: admin && values.platform ? 'platform' : 'user' })
      else if (editing)
        await updateAIPrompt(editing.id, input)
      await onChanged()
      toast.success(t('manage.saved'))
      setEditing(null)
    }
    catch (error) {
      toast.error(`${t('manage.save_failed')}: ${errorMessageT(error)}`)
    }
  }

  const visible = prompts.filter(prompt => prompt.mode === mode)
  const groups = [
    { key: 'platform', title: t('manage.platform_group'), items: visible.filter(prompt => prompt.scope === 'platform') },
    { key: 'user', title: t('manage.mine_group'), items: visible.filter(prompt => prompt.scope === 'user') },
  ]

  const renderRow = (prompt: AIPrompt) => (
    <li key={prompt.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{prompt.label}</span>
          {!prompt.editable && <LockIcon aria-label={t('manage.read_only')} className="size-3.5 shrink-0 text-muted-foreground" />}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{prompt.instruction}</span>
      </div>
      {prompt.editable && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t('manage.edit')} onClick={() => startEdit(prompt)}>
            <PencilIcon />
          </Button>
          <Popconfirm
            title={t('manage.delete_title', { label: prompt.label })}
            description={prompt.scope === 'platform' ? t('manage.delete_platform_description') : t('manage.delete_description')}
            confirmText={t('manage.delete')}
            errorText={t('manage.delete_failed')}
            destructive
            onConfirm={async () => {
              await deleteAIPrompt(prompt.id)
              await onChanged()
              toast.success(t('manage.deleted'))
            }}
          >
            <Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t('manage.delete')}>
              <Trash2Icon />
            </Button>
          </Popconfirm>
        </div>
      )}
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? (editing === 'new' ? t('manage.create') : t('manage.edit')) : t('manage.title')}</DialogTitle>
          <DialogDescription>{t('manage.description')}</DialogDescription>
        </DialogHeader>

        {!editing && (
          <div className="grid min-h-0 gap-3">
            <Tabs value={mode} onValueChange={value => setMode(value as AIWriteMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="rewrite">{t('rewrite')}</TabsTrigger>
                <TabsTrigger value="write">{t('write')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="-mx-2 grid min-h-0 content-start gap-3 overflow-y-auto px-2">
              {groups.map(group => (
                <section key={group.key} className="grid gap-1">
                  <h3 className="px-3 text-xs font-medium text-muted-foreground">
                    {group.title}
                    <span className="ml-1 tabular-nums">{group.items.length}</span>
                  </h3>
                  {group.items.length > 0
                    ? <ul className="grid gap-0.5">{group.items.map(renderRow)}</ul>
                    : <p className="px-3 py-2 text-xs text-muted-foreground">{group.key === 'user' ? t('manage.empty_mine') : t('manage.empty_platform')}</p>}
                </section>
              ))}
            </div>
          </div>
        )}

        {editing && (
          <Form {...form}>
            <form id="ai-prompt-form" className="grid content-start gap-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="label"
                rules={{ validate: value => (value.trim() ? true : t('manage.label_required')), maxLength: { value: MAX_LABEL, message: t('manage.too_long', { max: MAX_LABEL }) } }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('manage.label')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={MAX_LABEL} placeholder={t('manage.label_placeholder')} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="instruction"
                rules={{ validate: value => (value.trim() ? true : t('manage.instruction_required')), maxLength: { value: MAX_INSTRUCTION, message: t('manage.too_long', { max: MAX_INSTRUCTION }) } }}
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1">
                      <FormLabel>{t('manage.instruction')}</FormLabel>
                      <InfoTooltip content={t('manage.instruction_hint')} />
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{`${field.value.length}/${MAX_INSTRUCTION}`}</span>
                    </div>
                    <FormControl>
                      <Textarea {...field} rows={5} maxLength={MAX_INSTRUCTION} placeholder={t(mode === 'rewrite' ? 'manage.instruction_placeholder_rewrite' : 'manage.instruction_placeholder_write')} className="max-h-60 resize-y" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* 只有管理员新增时可以选择平台指令；范围创建后不可修改 */}
              {admin && editing === 'new' && (
                <FormField
                  control={form.control}
                  name="platform"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <LabelWithInfo info={t('manage.platform_hint')}>
                        <FormLabel>{t('manage.platform_switch')}</FormLabel>
                      </LabelWithInfo>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </form>
          </Form>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {editing
            ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    <ArrowLeftIcon />
                    {t('manage.back')}
                  </Button>
                  {/* 与“新增指令”按钮用不同的 key，避免复用同一 DOM 节点：点击新增后按钮变为 submit 会立即提交表单 */}
                  <Button key="save" type="submit" form="ai-prompt-form" disabled={form.formState.isSubmitting}>
                    {t('manage.save')}
                  </Button>
                </>
              )
            : (
                <>
                  <span className="hidden text-xs text-muted-foreground sm:block">{admin ? t('manage.admin_hint') : t('manage.editor_hint')}</span>
                  <Button key="add" type="button" onClick={() => startEdit('new')}>
                    <PlusIcon />
                    {t('manage.add')}
                  </Button>
                </>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 打开指令管理弹窗的小图标按钮（用于下拉菜单标题行等） */
export function AIPromptManageButton({ onClick, className }: { onClick: () => void, className?: string }) {
  const t = useTranslations('Console.editor.ai')
  return (
    <Button type="button" size="icon-sm" variant="ghost" className={className} aria-label={t('manage.title')} title={t('manage.title')} onClick={onClick}>
      <PencilIcon />
    </Button>
  )
}
