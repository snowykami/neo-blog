'use client'

import type { SearchSelectOption } from './shared'
import type { AIAgent, AIAgentTier } from '@/models/ai-agent'
import { Info, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { listUsers } from '@/api/admin'
import { convertUserToAIAgent, createAIAgent } from '@/api/ai-agent'
import { AssetField } from '@/components/common/asset-picker/asset-field'
import { UserAvatar } from '@/components/common/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { AI_AGENT_TIERS } from '@/models/ai-agent'
import { Role } from '@/models/user'
import { SearchSelect, useAIAgentT } from './shared'

// 与后端用户名 / 昵称校验保持一致（见 internal/service/admin_user.go）
export const USERNAME_MAX = 20
const NICKNAME_MAX = 20

export function isValidAIUsername(value: string) {
  return value.length <= USERNAME_MAX && !/[\s/@]/.test(value)
}
// 外部 http(s) 地址，或站内文件的稳定链接（/api/v1/file/f/<id>，从资产库选择时得到）
const URL_PATTERN = /^(?:https?:\/\/|\/)\S+$/i

type CreateMode = 'new' | 'convert'

interface CreateAgentForm {
  mode: CreateMode
  username: string
  nickname: string
  avatarUrl: string
  tier: AIAgentTier
  user: SearchSelectOption | null
}

// 类型选择：分段控件，下方显示所选类型的说明
export function TierToggle({ value, onChange }: { value: AIAgentTier, onChange: (tier: AIAgentTier) => void }) {
  const t = useAIAgentT()
  return (
    <div className="grid gap-2">
      <ToggleGroup
        type="single"
        variant="segmented"
        value={value}
        onValueChange={v => v && onChange(v as AIAgentTier)}
        className="w-full"
      >
        {AI_AGENT_TIERS.map(tier => (
          <ToggleGroupItem key={tier} value={tier}>{t(`tier.${tier}`)}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{t(`tier_desc.${value}`)}</p>
    </div>
  )
}

// 新建 AI 用户：新建账号，或把已有的普通用户设为 AI
export function CreateAgentDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agent: AIAgent) => void
}) {
  const t = useAIAgentT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        {open && <CreateAgentFormBody onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateAgentFormBody({ onCancel, onCreated }: { onCancel: () => void, onCreated: (agent: AIAgent) => void }) {
  const t = useAIAgentT()
  const commonT = useCommonT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const form = useForm<CreateAgentForm>({
    defaultValues: { mode: 'new', username: '', nickname: '', avatarUrl: '', tier: 'ambient', user: null },
  })
  const mode = form.watch('mode')

  // 只能选择角色为普通用户、且还不是 AI 的账号
  const searchUsers = useCallback(async (keyword: string): Promise<SearchSelectOption[]> => {
    const res = await listUsers({ page: 1, size: 20, keyword, role: Role.USER })
    return (res.data.users ?? [])
      .filter(user => !user.isAi)
      .map(user => ({
        value: user.id,
        label: user.nickname || user.username,
        description: `@${user.username}${user.email ? ` · ${user.email}` : ''}`,
        icon: <UserAvatar user={user} size={48} className="size-5" fallbackClassName="text-[10px]" />,
      }))
  }, [])

  const onSubmit = async (values: CreateAgentForm) => {
    try {
      const res = values.mode === 'new'
        ? await createAIAgent({
            username: values.username.trim(),
            nickname: values.nickname.trim(),
            avatarUrl: values.avatarUrl.trim(),
            tier: values.tier,
          })
        : await convertUserToAIAgent(values.user!.value, { tier: values.tier })
      toast.success(operationT('create_success'))
      onCreated(res.data)
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('create_failed')))
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Tabs value={mode} onValueChange={v => form.setValue('mode', v as CreateMode)}>
          <TabsList className="w-full">
            <TabsTrigger value="new">{t('create.mode_new')}</TabsTrigger>
            <TabsTrigger value="convert">{t('create.mode_convert')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'new'
          ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="username"
                    rules={{
                      validate: (v: string) => {
                        const value = v.trim()
                        if (!value)
                          return t('create.required', { field: commonT('username') })
                        if (!isValidAIUsername(value))
                          return t('create.invalid_username', { max: USERNAME_MAX })
                        return true
                      },
                    }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{commonT('username')}</FormLabel>
                        <FormControl><Input {...field} autoComplete="off" placeholder="ai_" /></FormControl>
                        <FormDescription>{t('create.username_hint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nickname"
                    rules={{ validate: (v: string) => v.trim().length <= NICKNAME_MAX || t('create.too_long', { max: NICKNAME_MAX }) }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('create.nickname')}</FormLabel>
                        <FormControl><Input {...field} autoComplete="off" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="avatarUrl"
                  rules={{ validate: (v: string) => !v.trim() || URL_PATTERN.test(v.trim()) || t('create.invalid_url') }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('create.avatar_url')}</FormLabel>
                      {/* 可粘贴外部地址，也可从资产库选择或上传 */}
                      <FormControl><AssetField {...field} autoComplete="off" previewClassName="rounded-full" pickerProps={{ title: t('create.avatar_url') }} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Alert>
                  <Info />
                  <AlertDescription>{t('create.new_hint')}</AlertDescription>
                </Alert>
              </>
            )
          : (
              <>
                <FormField
                  control={form.control}
                  name="user"
                  rules={{ validate: v => Boolean(v) || t('create.user_required') }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('create.select_user')}</FormLabel>
                      <SearchSelect
                        className="w-full"
                        selected={field.value}
                        placeholder={t('create.search_user')}
                        emptyText={t('create.no_user')}
                        search={searchUsers}
                        onSelect={field.onChange}
                      />
                      <FormDescription>{t('create.select_user_hint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertDescription>{t('create.convert_warning')}</AlertDescription>
                </Alert>
              </>
            )}
        <FormField
          control={form.control}
          name="tier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tier_label')}</FormLabel>
              <FormControl>
                <TierToggle value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormDescription>{t('create.profile_hint')}</FormDescription>
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {mode === 'new' ? t('create.submit_new') : t('create.submit_convert')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
