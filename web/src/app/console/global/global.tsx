'use client'

import type { KVItem } from '@/api/admin'
import type { BaseResponseError } from '@/models/resp'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createKV, deleteKV, listKV, setKV } from '@/api/admin'
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

const PRESET_KEYS = [
  'site_name',
  'site_description',
  'site_logo',
  'theme_color',
  'allow_register',
  'enable_register_from_oidc',
  'comments_per_page',
]

export default function GlobalPage() {
  const operationT = useOperationT()
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
      const err = error as BaseResponseError
      toast.error(`${operationT('fetch_failed')}: ${err?.response?.data?.message || err.message}`)
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
      toast.error('Key 不能为空')
      return
    }

    let value: unknown
    try {
      value = JSON.parse(valueInput)
    }
    catch {
      toast.error('Value 必须是合法 JSON')
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
      const err = error as BaseResponseError
      toast.error(`${operationT('save_failed')}: ${err?.response?.data?.message || err.message}`)
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
      const err = error as BaseResponseError
      toast.error(`${operationT('delete_failed')}: ${err?.response?.data?.message || err.message}`)
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
              placeholder="搜索 key"
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => handleNew()}>新建配置</Button>
        </div>
        <Separator />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">加载中...</TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">暂无配置</TableCell>
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
                    <Button size="sm" variant="outline" onClick={() => setSelectedKey(item.key)}>编辑</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(item.key)}>删除</Button>
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
            <CardTitle>{selectedKey ? '编辑配置' : '新建配置'}</CardTitle>
            <CardDescription>Value 会以 JSON 保存，字符串需要带双引号。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="kv-key">Key</Label>
              <Input
                id="kv-key"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                disabled={Boolean(selectedKey)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kv-value">Value</Label>
              <Textarea
                id="kv-value"
                className="min-h-60 font-mono text-xs"
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
              <Button type="button" variant="outline" onClick={() => handleNew()}>清空</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>常用 Key</CardTitle>
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
