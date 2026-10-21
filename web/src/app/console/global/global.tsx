'use client'

import type { KVItem } from '@/api/admin'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createKV, deleteKV, listKV, setKV } from '@/api/admin'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useOperationT } from '@/hooks/use-translations'
import { getErrorMessage } from '@/utils/common/error'

// 后端实际读取的配置键（site_info 为前台站点信息整体配置）
const PRESET_KEYS = [
  'site_info',
  'site_name',
  'site_description',
  'site_icon',
  'base_url',
  'enable_register',
  'enable_register_from_oidc',
  'max_reply_depth',
  'visit_log_retention_days',
]

export default function GlobalPage() {
  const operationT = useOperationT()
  const t = useTranslations('Console.global.kv')
  const [items, setItems] = useState<KVItem[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [valueInput, setValueInput] = useState('null')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [queryInput, setQueryInput, debouncedQuery] = useDebouncedState('', 200)

  const selectedItem = useMemo(
    () => items.find(item => item.key === selectedKey) || null,
    [items, selectedKey],
  )

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listKV(debouncedQuery)
      setItems(res.data.items)
      if (selectedKey && !res.data.items.some(item => item.key === selectedKey))
        setSelectedKey('')
    }
    catch (error) {
      toast.error(`${operationT('fetch_failed')}: ${getErrorMessage(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [debouncedQuery, operationT, selectedKey])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  useEffect(() => {
    if (!selectedItem)
      return
    setKeyInput(selectedItem.key)
    setValueInput(JSON.stringify(selectedItem.value, null, 2))
  }, [selectedItem])

  const handleNew = (key = '') => {
    setSelectedKey('')
    setKeyInput(key)
    setValueInput('null')
  }

  const handleSave = async () => {
    const key = keyInput.trim()
    if (!key) {
      toast.error(t('key_required'))
      return
    }

    let value: unknown
    try {
      value = JSON.parse(valueInput)
    }
    catch {
      toast.error(t('value_invalid_json'))
      return
    }

    setSaving(true)
    try {
      if (selectedKey) {
        await setKV({ key: selectedKey, value })
        setSelectedKey(key)
      }
      else {
        await createKV({ key, value })
        setSelectedKey(key)
      }
      toast.success(operationT('save_success'))
      await fetchItems()
    }
    catch (error) {
      toast.error(`${operationT('save_failed')}: ${getErrorMessage(error)}`)
    }
    finally {
      setSaving(false)
    }
  }

  const handleDelete = async (key: string) => {
    try {
      await deleteKV(key)
      toast.success(operationT('delete_success'))
      if (selectedKey === key)
        handleNew()
      await fetchItems()
    }
    catch (error) {
      toast.error(`${operationT('delete_failed')}: ${getErrorMessage(error)}`)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              type="search"
              placeholder={t('search_key')}
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => handleNew()}>{t('new_item')}</Button>
        </div>
        <Separator />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('key')}</TableHead>
              <TableHead>{t('value')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('loading')}</TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell>
              </TableRow>
            )}
            {!loading && items.map(item => (
              <TableRow key={item.key}>
                <TableCell className="font-mono">{item.key}</TableCell>
                <TableCell className="max-w-[28rem] truncate font-mono text-xs text-muted-foreground">
                  {JSON.stringify(item.value)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedKey(item.key)}>{operationT('edit')}</Button>
                    {/* 删除配置前需二次确认 */}
                    <ConfirmDialog
                      title={operationT('confirm_delete')}
                      description={t('delete_description', { key: item.key })}
                      confirmLabel={operationT('delete')}
                      confirmVariant="destructive"
                      onConfirm={() => handleDelete(item.key)}
                    >
                      <Button size="sm" variant="destructive">{operationT('delete')}</Button>
                    </ConfirmDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>{selectedKey ? t('edit_item') : t('new_item')}</CardTitle>
            <CardDescription>{t('value_hint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="kv-key">{t('key')}</Label>
              <Input
                id="kv-key"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                disabled={Boolean(selectedKey)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kv-value">{t('value')}</Label>
              <Textarea
                id="kv-value"
                className="min-h-60 font-mono text-xs"
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>{saving ? t('saving') : operationT('save')}</Button>
              <Button type="button" variant="outline" onClick={() => handleNew()}>{t('clear')}</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>{t('preset_keys')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PRESET_KEYS.map(key => (
              <Button key={key} size="sm" variant="outline" onClick={() => handleNew(key)}>
                {key}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function ColorPick() {}
