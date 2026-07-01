'use client'

import type { OidcConfig } from '@/models/oidc-config'
import type { BaseResponseError } from '@/models/resp'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  createOidcAdmin,
  deleteOidcAdmin,
  listOidcAdmin,
  updateOidcAdmin,
} from '@/api/admin'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

type OidcForm = Omit<OidcConfig, 'id' | 'loginUrl'> & { id?: number }
type TokenAuthMethod = NonNullable<OidcConfig['tokenAuthMethod']>

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

export default function OidcManage() {
  const operationT = useOperationT()
  const [configs, setConfigs] = useState<OidcConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<OidcForm>(EMPTY_FORM)

  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOidcAdmin()
      setConfigs(res.data)
    }
    catch (error) {
      const err = error as BaseResponseError
      toast.error(`${operationT('fetch_failed')}: ${err?.response?.data?.message || err.message}`)
    }
    finally {
      setLoading(false)
    }
  }, [operationT])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  const openCreateDialog = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEditDialog = (config: OidcConfig) => {
    setForm({
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
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.clientId?.trim()) {
      toast.error('名称和 Client ID 不能为空')
      return
    }

    try {
      if (form.id) {
        await updateOidcAdmin({ ...form, id: form.id })
        toast.success(operationT('update_success'))
      }
      else {
        await createOidcAdmin(form)
        toast.success(operationT('create_success'))
      }
      setDialogOpen(false)
      await fetchConfigs()
    }
    catch (error) {
      const err = error as BaseResponseError
      toast.error(`${operationT('save_failed')}: ${err?.response?.data?.message || err.message}`)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteOidcAdmin(id)
      toast.success(operationT('delete_success'))
      await fetchConfigs()
    }
    catch (error) {
      const err = error as BaseResponseError
      toast.error(`${operationT('delete_failed')}: ${err?.response?.data?.message || err.message}`)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">认证源</h1>
          <p className="text-sm text-muted-foreground">管理 OAuth2 / Misskey OIDC 登录配置。</p>
        </div>
        <Button size="sm" onClick={openCreateDialog}>
          <Plus className="size-4" />
          新建认证源
        </Button>
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>Issuer</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">加载中...</TableCell>
            </TableRow>
          )}
          {!loading && configs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无认证源</TableCell>
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
              <TableCell>{config.enabled ? '启用' : '停用'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(config)}>编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(config.id)}>删除</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? '编辑认证源' : '新建认证源'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormInput label="名称" value={form.name} onChange={name => setForm(prev => ({ ...prev, name }))} />
              <FormInput label="显示名称" value={form.displayName} onChange={displayName => setForm(prev => ({ ...prev, displayName }))} />
              <FormInput label="Client ID" value={form.clientId || ''} onChange={clientId => setForm(prev => ({ ...prev, clientId }))} />
              <FormInput label="Client Secret" value={form.clientSecret || ''} onChange={clientSecret => setForm(prev => ({ ...prev, clientSecret }))} />
              <TokenAuthMethodSelect
                value={form.tokenAuthMethod || 'client_secret_post'}
                onChange={tokenAuthMethod => setForm(prev => ({ ...prev, tokenAuthMethod }))}
              />
              <FormInput label="图标 URL" value={form.icon} onChange={icon => setForm(prev => ({ ...prev, icon }))} />
              <FormInput label="类型" value={form.type || 'oauth2'} onChange={type => setForm(prev => ({ ...prev, type }))} />
            </div>
            <FormInput label="Discovery URL" value={form.oidcDiscoveryUrl || ''} onChange={oidcDiscoveryUrl => setForm(prev => ({ ...prev, oidcDiscoveryUrl }))} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormInput label="Issuer" value={form.issuer || ''} onChange={issuer => setForm(prev => ({ ...prev, issuer }))} />
              <FormInput label="Authorization Endpoint" value={form.authorizationEndpoint || ''} onChange={authorizationEndpoint => setForm(prev => ({ ...prev, authorizationEndpoint }))} />
              <FormInput label="Token Endpoint" value={form.tokenEndpoint || ''} onChange={tokenEndpoint => setForm(prev => ({ ...prev, tokenEndpoint }))} />
              <FormInput label="Userinfo Endpoint" value={form.userinfoEndpoint || ''} onChange={userinfoEndpoint => setForm(prev => ({ ...prev, userinfoEndpoint }))} />
              <FormInput label="JWKS URI" value={form.jwksUri || ''} onChange={jwksUri => setForm(prev => ({ ...prev, jwksUri }))} />
              <div className="grid gap-2">
                <Label>启用</Label>
                <Switch
                  checked={form.enabled ?? true}
                  onCheckedChange={enabled => setForm(prev => ({ ...prev, enabled }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{operationT('cancel')}</Button>
            <Button onClick={handleSave}>{operationT('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TokenAuthMethodSelect({
  onChange,
  value,
}: {
  onChange: (value: TokenAuthMethod) => void
  value: TokenAuthMethod
}) {
  const handleValueChange = (nextValue: string) => {
    if (nextValue === 'client_secret_post' || nextValue === 'client_secret_basic') {
      onChange(nextValue)
    }
  }

  return (
    <div className="grid gap-2">
      <Label>Token 认证方式</Label>
      <Select value={value} onValueChange={handleValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="client_secret_post">client_secret_post</SelectItem>
          <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function FormInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
