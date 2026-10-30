'use client'

import type { APITokenScope } from '@/models/api-token'
import { Copy, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createAPIToken } from '@/api/api-token'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'
import { API_TOKEN_SCOPES, EDITOR_ONLY_SCOPES } from '@/models/api-token'
import { isEditor } from '@/utils/common/permission'

const NAME_MAX_LENGTH = 64
const EXPIRY_OPTIONS = ['7', '30', '90', '365', 'never'] as const
const DAY_MS = 24 * 60 * 60 * 1000
// 外部 AI 工具连接的 MCP 端点，经前端 rewrites 转发到后端
const MCP_PATH = '/api/v1/mcp'

interface FormValues {
  name: string
  scopes: APITokenScope[]
  expiry: (typeof EXPIRY_OPTIONS)[number]
}

const DEFAULT_VALUES: FormValues = { name: '', scopes: ['posts:read', 'posts:write'], expiry: '90' }

export function CreateAPITokenDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('Console.api_tokens')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const { user } = useAuth()
  const canWritePosts = Boolean(user && isEditor({ user }))
  const [open, setOpen] = useState(false)
  // 新建 Token 的明文只在本次弹窗中展示，关闭后无法再次查看
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const form = useForm<FormValues>({ mode: 'onChange', defaultValues: DEFAULT_VALUES })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(DEFAULT_VALUES)
      setCreatedToken(null)
    }
    setOpen(nextOpen)
  }

  const onSubmit = async ({ name, scopes, expiry }: FormValues) => {
    try {
      const res = await createAPIToken({
        name: name.trim(),
        scopes,
        expiresAt: expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * DAY_MS).toISOString(),
      })
      setCreatedToken(res.data.token)
      onCreated()
    }
    catch (error) {
      const message = errorMessageT(error)
      toast.error(operationT('create_failed') + (message ? `: ${message}` : ''))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('create')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        {createdToken
          ? <CreatedToken token={createdToken} onDone={() => setOpen(false)} />
          : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('create')}</DialogTitle>
                  <DialogDescription>{t('create_description')}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
                    <FormField
                      control={form.control}
                      name="name"
                      rules={{
                        validate: value => value.trim() !== '' || t('name_required'),
                        maxLength: { value: NAME_MAX_LENGTH, message: t('name_too_long', { max: NAME_MAX_LENGTH }) },
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('name')}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={t('name_placeholder')} autoComplete="off" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="scopes"
                      rules={{ validate: value => value.length > 0 || t('scopes_required') }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('scopes')}</FormLabel>
                          <div className="grid gap-3">
                            {API_TOKEN_SCOPES.map((scope) => {
                              const disabled = EDITOR_ONLY_SCOPES.includes(scope) && !canWritePosts
                              return (
                                <label key={scope} className="flex items-start gap-3 text-sm">
                                  <Checkbox
                                    className="mt-0.5"
                                    disabled={disabled}
                                    checked={field.value.includes(scope)}
                                    onCheckedChange={checked => field.onChange(
                                      checked ? [...field.value, scope] : field.value.filter(s => s !== scope),
                                    )}
                                  />
                                  <span className="grid gap-0.5">
                                    <code className="font-mono text-xs font-medium">{scope}</code>
                                    <span className="text-muted-foreground">
                                      {t(`scope_${scope.replace(':', '_')}`)}
                                      {disabled && ` ${t('scope_requires_editor')}`}
                                    </span>
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="expiry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('expires_at')}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {EXPIRY_OPTIONS.map(option => (
                                <SelectItem key={option} value={option}>
                                  {option === 'never' ? t('never_expires') : t('expires_in_days', { days: Number(option) })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <div className="flex gap-3">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{operationT('cancel')}</Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>{operationT('create')}</Button>
                      </div>
                    </DialogFooter>
                  </form>
                </Form>
              </>
            )}
      </DialogContent>
    </Dialog>
  )
}

function CopyableBlock({ label, value }: { label: string, value: string }) {
  const t = useTranslations('Console.api_tokens')
  const copy = async () => {
    if (await copyToClipboard(value))
      toast.success(t('copied'))
    else
      toast.error(t('copy_failed'))
  }
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-start gap-3">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">{value}</pre>
        <Button type="button" size="icon" variant="outline" className="shrink-0" aria-label={t('copy')} onClick={copy}>
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function CreatedToken({ token, onDone }: { token: string, onDone: () => void }) {
  const t = useTranslations('Console.api_tokens')
  const endpoint = `${window.location.origin}${MCP_PATH}`
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('created_title')}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <Alert>
          <AlertTitle>{t('created_once_title')}</AlertTitle>
          <AlertDescription>{t('created_once_description')}</AlertDescription>
        </Alert>
        <CopyableBlock label={t('token')} value={token} />
        <CopyableBlock
          label={t('connect_claude_code')}
          value={`claude mcp add --transport http neo-blog ${endpoint} --header "Authorization: Bearer ${token}"`}
        />
        <CopyableBlock
          label={t('connect_json')}
          value={JSON.stringify({ mcpServers: { 'neo-blog': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}
        />
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone}>{t('done')}</Button>
      </DialogFooter>
    </>
  )
}
