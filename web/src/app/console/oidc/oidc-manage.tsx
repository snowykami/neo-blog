'use client'

import type { OidcConfig } from '@/models/oidc-config'
import { Loader2, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  createOidcAdmin,
  deleteOidcAdmin,
  listOidcAdmin,
  updateOidcAdmin,
} from '@/api/admin'
import { AssetField } from '@/components/common/asset-picker'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOperationT } from '@/hooks/use-translations'
import { getErrorMessage } from '@/utils/common/error'

type OidcForm = Omit<OidcConfig, 'id' | 'loginUrl'> & { id?: number }

// 后端支持的认证源类型（见 internal/model/oidc_config.go）
const OIDC_TYPES = ['oauth2', 'misskey'] as const
const TOKEN_AUTH_METHODS = ['client_secret_post', 'client_secret_basic'] as const

const EMPTY_FORM: OidcForm = {
  name: '',
  displayName: '',
  icon: '',
  clientId: '',
  clientSecret: '',
  tokenAuthMethod: 'client_secret_post',
  oidcDiscoveryUrl: '',
  issuer: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  userinfoEndpoint: '',
  jwksUri: '',
  type: 'oauth2',
  enabled: true,
}

function toForm(config: OidcConfig): OidcForm {
  return {
    id: config.id,
    name: config.name,
    displayName: config.displayName || '',
    icon: config.icon || '',
    clientId: config.clientId || '',
    clientSecret: config.clientSecret || '',
    tokenAuthMethod: config.tokenAuthMethod || 'client_secret_post',
    oidcDiscoveryUrl: config.oidcDiscoveryUrl || '',
    issuer: config.issuer || '',
    authorizationEndpoint: config.authorizationEndpoint || '',
    tokenEndpoint: config.tokenEndpoint || '',
    userinfoEndpoint: config.userinfoEndpoint || '',
    jwksUri: config.jwksUri || '',
    type: config.type || 'oauth2',
    enabled: config.enabled ?? true,
  }
}

export default function OidcManage() {
  const t = useTranslations('Console.oidc')
  const operationT = useOperationT()
  const [configs, setConfigs] = useState<OidcConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<OidcForm>(EMPTY_FORM)

  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOidcAdmin()
      setConfigs(res.data)
    }
    catch (error) {
      toast.error(`${operationT('fetch_failed')}: ${getErrorMessage(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [operationT])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  const openCreateDialog = () => {
    setEditing(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEditDialog = (config: OidcConfig) => {
    setEditing(toForm(config))
    setDialogOpen(true)
  }

  // 删除失败时抛出，由 ConfirmDialog 统一提示并保持打开
  const handleDelete = async (id: number) => {
    await deleteOidcAdmin(id)
    toast.success(operationT('delete_success'))
    await fetchConfigs()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button size="sm" onClick={openCreateDialog}>
          <Plus className="size-4" />
          {t('create')}
        </Button>
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('type')}</TableHead>
            <TableHead>Issuer</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead className="text-right">{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('loading')}</TableCell>
            </TableRow>
          )}
          {!loading && configs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell>
            </TableRow>
          )}
          {!loading && configs.map(config => (
            <TableRow key={config.id}>
              <TableCell>
                <div className="font-medium">{config.displayName || config.name}</div>
                <div className="text-xs text-muted-foreground">{config.name}</div>
              </TableCell>
              <TableCell>{config.type || 'oauth2'}</TableCell>
              <TableCell className="max-w-80 truncate">{config.issuer || config.oidcDiscoveryUrl || '-'}</TableCell>
              <TableCell>{config.enabled ? t('enabled') : t('disabled')}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(config)}>{operationT('edit')}</Button>
                  {/* 删除认证源会让已绑定的用户无法再用它登录，使用 AlertDialog 确认 */}
                  <ConfirmDialog
                    title={operationT('confirm_delete')}
                    description={t('delete_description')}
                    confirmLabel={operationT('delete')}
                    errorText={operationT('delete_failed')}
                    confirmVariant="destructive"
                    onConfirm={() => handleDelete(config.id)}
                  >
                    <Button size="sm" variant="destructive">{operationT('delete')}</Button>
                  </ConfirmDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing.id ? t('edit') : t('create')}</DialogTitle>
          </DialogHeader>
          {dialogOpen && (
            <OidcConfigForm
              initialValues={editing}
              onCancel={() => setDialogOpen(false)}
              onSaved={async () => {
                setDialogOpen(false)
                await fetchConfigs()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OidcConfigForm({
  initialValues,
  onCancel,
  onSaved,
}: {
  initialValues: OidcForm
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const t = useTranslations('Console.oidc')
  const operationT = useOperationT()
  const form = useForm<OidcForm>({
    defaultValues: initialValues,
    mode: 'onChange',
  })
  const { control, formState } = form

  const onSubmit = async (data: OidcForm) => {
    const payload: OidcForm = {
      ...data,
      name: data.name.trim(),
      clientId: data.clientId?.trim(),
    }
    try {
      if (payload.id) {
        await updateOidcAdmin({ ...payload, id: payload.id })
        toast.success(operationT('update_success'))
      }
      else {
        await createOidcAdmin(payload)
        toast.success(operationT('create_success'))
      }
      await onSaved()
    }
    catch (error) {
      toast.error(`${operationT('save_failed')}: ${getErrorMessage(error)}`)
    }
  }

  // 普通文本字段
  const textField = (
    name: 'name' | 'displayName' | 'clientId' | 'clientSecret' | 'oidcDiscoveryUrl' | 'issuer' | 'authorizationEndpoint' | 'tokenEndpoint' | 'userinfoEndpoint' | 'jwksUri',
    label: string,
    options: { required?: boolean, type?: string } = {},
  ) => (
    <FormField
      control={control}
      name={name}
      rules={options.required ? { validate: v => !!String(v ?? '').trim() || t('required', { field: label }) } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ''}
              type={options.type}
              autoComplete={options.type === 'password' ? 'new-password' : undefined}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {textField('name', t('name'), { required: true })}
          {textField('displayName', t('display_name'))}
          {textField('clientId', 'Client ID', { required: true })}
          {textField('clientSecret', 'Client Secret', { type: 'password' })}
          <FormField
            control={control}
            name="tokenAuthMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('token_auth_method')}</FormLabel>
                <Select value={field.value || 'client_secret_post'} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TOKEN_AUTH_METHODS.map(method => (
                      <SelectItem key={method} value={method}>{method}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="icon"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('icon_url')}</FormLabel>
                <FormControl>
                  <AssetField {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('type')}</FormLabel>
                <Select value={field.value || 'oauth2'} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OIDC_TYPES.map(type => (
                      <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {textField('oidcDiscoveryUrl', 'Discovery URL')}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {textField('issuer', 'Issuer')}
          {textField('authorizationEndpoint', 'Authorization Endpoint')}
          {textField('tokenEndpoint', 'Token Endpoint')}
          {textField('userinfoEndpoint', 'Userinfo Endpoint')}
          {textField('jwksUri', 'JWKS URI')}
          <FormField
            control={control}
            name="enabled"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('enabled')}</FormLabel>
                <FormControl>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{operationT('cancel')}</Button>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {operationT('save')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
