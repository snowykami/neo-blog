'use client'

import type { KVItem } from '@/api/admin'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createKV, deleteKV, listKV, setKV } from '@/api/admin'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { STICKY_ACTIONS_CLASS } from '@/components/console/common/sticky-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { useStandaloneConfigKeys } from './settings-form'

interface KVFormValues {
  key: string
  secret: boolean
  value: string
}

export default function GlobalPage() {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  // 后端实际读取的配置键：site_info 为前台站点信息整体配置，其余来自配置注册表
  const presetKeys = ['site_info', ...useStandaloneConfigKeys()]
  const t = useTranslations('Console.global.kv')
  const [items, setItems] = useState<KVItem[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [queryInput, setQueryInput, debouncedQuery] = useDebouncedState('', 200)
  const form = useForm<KVFormValues>({
    defaultValues: {
      key: '',
      secret: false,
      value: 'null',
    },
  })

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
      toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [debouncedQuery, errorMessageT, operationT, selectedKey])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  useEffect(() => {
    if (!selectedItem)
      return
    // 敏感项后端不回传明文，留空表示仅修改敏感标记或保持原值不变
    form.reset({
      key: selectedItem.key,
      secret: Boolean(selectedItem.secret),
      value: selectedItem.secret ? '' : JSON.stringify(selectedItem.value, null, 2),
    })
  }, [form, selectedItem])

  const handleNew = (key = '') => {
    setSelectedKey('')
    form.reset({
      key,
      secret: false,
      value: 'null',
    })
  }

  const onSubmit = async (values: KVFormValues) => {
    const key = values.key.trim()
    const trimmedValue = values.value.trim()
    // 编辑已标记为敏感的项且未输入新值时，只更新敏感布尔标记，不覆盖已有值
    const keepExistingSecretValue = Boolean(selectedKey && selectedItem?.secret && trimmedValue === '')
    const value = keepExistingSecretValue ? undefined : JSON.parse(values.value)

    try {
      if (selectedKey) {
        await setKV({
          key: selectedKey,
          value,
          secret: values.secret,
          updateValue: !keepExistingSecretValue,
        })
        setSelectedKey(key)
      }
      else {
        await createKV({ key, value, secret: values.secret })
        setSelectedKey(key)
      }
      toast.success(operationT('save_success'))
      await fetchItems()
    }
    catch (error) {
      toast.error(`${operationT('save_failed')}: ${errorMessageT(error)}`)
    }
  }

  // 删除失败时抛出，由 ConfirmDialog 统一提示并保持打开
  const handleDelete = async (key: string) => {
    await deleteKV(key)
    toast.success(operationT('delete_success'))
    if (selectedKey === key)
      handleNew()
    await fetchItems()
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
              <TableHead className={`text-right ${STICKY_ACTIONS_CLASS}`}>{t('actions')}</TableHead>
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
                <TableCell className="font-mono">
                  <span>{item.key}</span>
                  {item.secret && (
                    <Badge variant="secondary" className="ml-2 font-sans text-[11px]">{t('secret_badge')}</Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-[28rem] truncate font-mono text-xs text-muted-foreground">
                  {item.secret
                    ? <span className="font-sans italic">{item.hasValue ? t('secret_masked') : t('secret_empty')}</span>
                    : JSON.stringify(item.value)}
                </TableCell>
                <TableCell className={`text-right ${STICKY_ACTIONS_CLASS}`}>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedKey(item.key)}>{operationT('edit')}</Button>
                    {/* 全局配置影响全站运行，删除使用 AlertDialog 确认 */}
                    <ConfirmDialog
                      title={operationT('confirm_delete')}
                      description={t('delete_description', { key: item.key })}
                      confirmLabel={operationT('delete')}
                      errorText={operationT('delete_failed')}
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
          <CardContent>
            <Form {...form}>
              <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                  control={form.control}
                  name="key"
                  rules={{ validate: v => !!v.trim() || t('key_required') }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('key')}</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={Boolean(selectedKey)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secret"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="grid gap-1">
                        <FormLabel>{t('secret_label')}</FormLabel>
                        <FormDescription className="text-xs">{t('secret_hint')}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="value"
                  rules={{
                    validate: (v) => {
                      if (selectedKey && selectedItem?.secret && v.trim() === '')
                        return true
                      try {
                        JSON.parse(v)
                        return true
                      }
                      catch {
                        return t('value_invalid_json')
                      }
                    },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('value')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          className="min-h-60 font-mono text-xs"
                          placeholder={selectedItem?.secret && selectedItem.hasValue ? t('secret_value_placeholder') : undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? t('saving') : operationT('save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handleNew()}>{t('clear')}</Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>{t('preset_keys')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {presetKeys.map(key => (
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
