'use client'

import type { ConfigItem } from '@/models/config'
import type { NCMPlaylists } from '@/models/music'
import { EyeIcon, EyeOffIcon, ListMusicIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { listNCMPlaylists } from '@/api/music'
import { AssetField } from '@/components/common/asset-picker'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { ColorField } from '@/components/console/common/color-field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { SidebarCardsField } from './sidebar-cards-field'

// 表单值：键为配置键（snake_case）
export type ConfigValues = Record<string, unknown>

interface FieldProps {
  item: ConfigItem
  label: string
  description?: string
}

// 这些类型的输入较宽，总是占满整行
const WIDE_TYPES = new Set(['image', 'image_list', 'string_list', 'link_list', 'bool', 'json'])

/** 注册表文案的 i18n 键 → 文本；缺少翻译时直接显示键名，便于发现漏写的文案 */
export function useConfigT() {
  const t = useTranslations('Console.global')
  return useCallback((key?: string) => (key ? (t.has(key) ? t(key) : key) : undefined), [t])
}

/**
 * 按配置项的类型渲染输入组件：开关、文本、数字、单选、列表等；有 widget 时使用专用组件。
 * 环境变量设置了该项时只读显示环境变量的值（后台的配置此时不生效）
 */
export function ConfigField({ item }: { item: ConfigItem }) {
  const tr = useConfigT()
  const props: FieldProps = { item, label: tr(item.label) ?? item.key, description: tr(item.description) }
  if (item.envValue)
    return <EnvValueItem {...props} />
  switch (item.widget) {
    case 'color_schemes':
      return <ColorSchemesField {...props} />
    case 'color_scheme':
      return <ColorSchemeSelect {...props} />
    case 'sidebar_cards':
      return <SidebarCardsField name={item.key} label={props.label} description={props.description} />
    case 'ncm_playlist':
      return <NCMPlaylistField {...props} />
  }
  switch (item.type) {
    case 'bool':
      return <SwitchField {...props} />
    case 'int':
    case 'float':
      return <NumberField {...props} />
    case 'enum':
      return <SelectField {...props} />
    case 'text':
      return <TextAreaField {...props} />
    case 'secret':
      return <SecretField {...props} />
    case 'image':
      return <ImageField {...props} />
    case 'color':
      return <ColorField<ConfigValues> name={item.key} label={props.label} description={props.description} />
    case 'string_list':
      return item.options?.length ? <MultiSelectField {...props} /> : <StringListField {...props} />
    case 'image_list':
      return <ImageListField {...props} />
    case 'link_list':
      return <LinkListField {...props} />
    case 'json':
      return null
  }
  return <TextField {...props} />
}

function itemClass(item: ConfigItem) {
  return item.wide || WIDE_TYPES.has(item.type) ? 'md:col-span-2' : undefined
}

function FieldLabel({ label, description }: { label: string, description?: string }) {
  return <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
}

// 由环境变量设置的值：只读显示并说明；密钥默认隐藏，开关按环境变量的取值显示
function EnvValueItem({ item, label, description }: FieldProps) {
  const t = useTranslations('Console.global')
  const [visible, setVisible] = useState(false)
  const value = item.envValue ?? ''
  const note = <FormDescription>{t(item.envUnit === 'seconds' ? 'env_override_seconds_note' : 'env_override_note', { name: item.env ?? '' })}</FormDescription>
  if (item.type === 'bool') {
    return (
      <FormItem className="grid gap-2 rounded-lg border p-3 md:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <FieldLabel label={label} description={description} />
          {/* 与后端 strconv.ParseBool 一致；无法解析的取值后端不会下发 */}
          <Switch checked={['1', 't', 'T', 'TRUE', 'true', 'True'].includes(value)} disabled />
        </div>
        {note}
      </FormItem>
    )
  }
  const secret = item.type === 'secret'
  return (
    <FormItem className={itemClass(item)}>
      <FieldLabel label={label} description={description} />
      <div className="relative">
        <Input type={secret && !visible ? 'password' : 'text'} value={value} readOnly disabled className={secret ? 'pr-10' : undefined} />
        {secret && <RevealButton visible={visible} onToggle={() => setVisible(v => !v)} />}
      </div>
      {note}
    </FormItem>
  )
}

// 密钥输入框右侧的显示 / 隐藏切换
function RevealButton({ visible, onToggle }: { visible: boolean, onToggle: () => void }) {
  const t = useTranslations('Console.global')
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
      aria-label={visible ? t('hide_secret') : t('show_secret')}
      title={visible ? t('hide_secret') : t('show_secret')}
      onClick={onToggle}
    >
      {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
    </Button>
  )
}

function usePlaceholder(item: ConfigItem) {
  const tr = useConfigT()
  return tr(item.placeholderKey) ?? item.placeholder
}

// 单行文本；链接与邮箱只用于适配移动端键盘，不做浏览器原生校验（站内相对链接也允许）
function TextField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  const placeholder = usePlaceholder(item) ?? (item.type === 'url' ? 'https://' : undefined)
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <FormControl>
            <Input type={item.type === 'url' ? 'url' : item.type === 'email' ? 'email' : 'text'} placeholder={placeholder} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

function TextAreaField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  const placeholder = usePlaceholder(item)
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <FormControl>
            <Textarea rows={item.rows || 3} placeholder={placeholder} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

function SecretField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  const [visible, setVisible] = useState(false)
  const placeholder = usePlaceholder(item)
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <div className="relative">
            <FormControl>
              <Input
                type={visible ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder={placeholder}
                className="pr-10"
                {...field}
                value={(field.value as string) ?? ''}
              />
            </FormControl>
            <RevealButton visible={visible} onToggle={() => setVisible(v => !v)} />
          </div>
        </FormItem>
      )}
    />
  )
}

// 数字：按声明的取值范围校验，整数不接受小数
function NumberField({ item, label, description }: FieldProps) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<ConfigValues>()
  const validate = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number.NaN
    if (Number.isNaN(n) || (item.type === 'int' && !Number.isInteger(n)))
      return t('invalid_number')
    if ((item.min != null && n < item.min) || (item.max != null && n > item.max))
      return t('value_out_of_range', { min: item.min ?? '-∞', max: item.max ?? '∞' })
    return true
  }
  return (
    <FormField
      control={control}
      name={item.key}
      rules={{ validate }}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <FormControl>
            <Input
              type="number"
              min={item.min}
              max={item.max}
              step={item.step || (item.type === 'int' ? 1 : 'any')}
              value={(field.value as number) ?? ''}
              onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={field.onBlur}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function SwitchField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 md:col-span-2">
          <FieldLabel label={label} description={description} />
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

function SelectField({ item, label, description }: FieldProps) {
  const tr = useConfigT()
  const { control } = useFormContext<ConfigValues>()
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              {item.options?.map(option => <SelectItem key={option.value} value={option.value}>{tr(option.label) ?? option.value}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  )
}

// 多选：勾选可选值，保持声明中的顺序
function MultiSelectField({ item, label, description, renderOption }: FieldProps & { renderOption?: (value: string) => React.ReactNode }) {
  const tr = useConfigT()
  const { control } = useFormContext<ConfigValues>()
  const options = item.options ?? []
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => {
        const selected = (field.value as string[] | undefined) ?? []
        return (
          <FormItem className="md:col-span-2">
            <FieldLabel label={label} description={description} />
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const checked = selected.includes(option.value)
                return (
                  <label key={option.value} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors', checked && 'border-primary')}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={next => field.onChange(options
                        .map(o => o.value)
                        .filter(value => (value === option.value ? next === true : selected.includes(value))))}
                    />
                    {renderOption?.(option.value)}
                    {tr(option.label) ?? option.value}
                  </label>
                )
              })}
            </div>
          </FormItem>
        )
      }}
    />
  )
}

function ImageField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FieldLabel label={label} description={description} />
          <FormControl>
            <AssetField value={(field.value as string) ?? ''} onChange={field.onChange} clearable placeholder="https://" />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

// 可增删的列表，renderItem 负责单项的输入控件
function ListEditor<T>({ items, onChange, createItem, renderItem }: {
  items: T[]
  onChange: (items: T[]) => void
  createItem: () => T
  renderItem: (item: T, update: (item: T) => void) => React.ReactNode
}) {
  const t = useTranslations('Console.global')
  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        // 列表项没有稳定 ID，按位置编辑
        <div key={index} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{renderItem(item, next => onChange(items.map((old, i) => (i === index ? next : old))))}</div>
          <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} onClick={() => onChange(items.filter((_, i) => i !== index))}>
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...items, createItem()])}>
        <PlusIcon className="size-4" />
        {t('add')}
      </Button>
    </div>
  )
}

function StringListField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  const placeholder = usePlaceholder(item)
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FieldLabel label={label} description={description} />
          <ListEditor<string>
            items={(field.value as string[] | undefined) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(value, update) => <Input placeholder={placeholder} value={value} onChange={e => update(e.target.value)} />}
          />
        </FormItem>
      )}
    />
  )
}

function ImageListField({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FieldLabel label={label} description={description} />
          <ListEditor<string>
            items={(field.value as string[] | undefined) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(value, update) => <AssetField value={value} onChange={update} placeholder="https://" />}
          />
        </FormItem>
      )}
    />
  )
}

function LinkListField({ item, label, description }: FieldProps) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<ConfigValues>()
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FieldLabel label={label} description={description} />
          <ListEditor<{ text: string, href: string }>
            items={(field.value as { text: string, href: string }[] | undefined) ?? []}
            onChange={field.onChange}
            createItem={() => ({ text: '', href: '' })}
            renderItem={(link, update) => (
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <Input placeholder={t('link_text')} value={link.text} onChange={e => update({ ...link, text: e.target.value })} />
                <Input type="url" placeholder="https://" value={link.href} onChange={e => update({ ...link, href: e.target.value })} />
              </div>
            )}
          />
        </FormItem>
      )}
    />
  )
}

// ---- 专用组件 ----

// 配色色块直接使用对应主题的主色
function ColorSwatch({ scheme }: { scheme: string }) {
  return <span data-user-color={scheme} className="inline-block size-4 shrink-0 rounded-full bg-primary ring-1 ring-border" />
}

// 允许用户切换的配色：多选，带色块
function ColorSchemesField(props: FieldProps) {
  return <MultiSelectField {...props} renderOption={scheme => <ColorSwatch scheme={scheme} />} />
}

// 默认配色：只能从已勾选的配色中选择（都没勾选时可选全部）
function ColorSchemeSelect({ item, label, description }: FieldProps) {
  const { control } = useFormContext<ConfigValues>()
  const enabled = (useWatch<ConfigValues>({ name: 'color_schemes' }) as string[] | undefined) ?? []
  const all = item.options?.map(option => option.value) ?? []
  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => (
        <FormItem className={itemClass(item)}>
          <FieldLabel label={label} description={description} />
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              {(enabled.length > 0 ? enabled : all).map(scheme => (
                <SelectItem key={scheme} value={scheme}>
                  <span className="flex items-center gap-2">
                    <ColorSwatch scheme={scheme} />
                    {scheme}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  )
}

// 网易云歌单：用当前填写的 API 地址与 Cookie 读取账号歌单（未保存也可以先读取），选择其一作为博客歌单
function NCMPlaylistField({ item, label, description }: FieldProps) {
  const t = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const { control, getValues } = useFormContext<ConfigValues>()
  const [result, setResult] = useState<NCMPlaylists | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const credentials = useCallback(() => ({
    apiBaseUrl: String(getValues('ncm_api_base_url') ?? '').trim(),
    cookie: String(getValues('ncm_cookie') ?? '').trim(),
  }), [getValues])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listNCMPlaylists(credentials())
      setResult(res.data)
    }
    catch (err) {
      setResult(null)
      setError(errorMessageT(err, t('ncm_load_failed')))
    }
    finally {
      setLoading(false)
    }
  }, [credentials, errorMessageT, t])

  // 已保存配置时自动读取一次，以显示当前所选歌单的名称
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current)
      return
    autoLoaded.current = true
    const { apiBaseUrl, cookie } = credentials()
    if (apiBaseUrl && cookie)
      void load()
  }, [credentials, load])

  return (
    <FormField
      control={control}
      name={item.key}
      render={({ field }) => {
        const selectedId = Number(field.value) || 0
        const known = result?.playlists.some(playlist => playlist.id === selectedId)
        return (
          <FormItem className="md:col-span-2">
            <FieldLabel label={label} description={description} />
            <div className="flex gap-3">
              <Select value={selectedId ? String(selectedId) : ''} onValueChange={value => field.onChange(Number(value))} disabled={!result}>
                <FormControl>
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder={selectedId && !known ? t('ncm_playlist_id', { id: selectedId }) : t(result ? 'ncm_playlist_select' : 'ncm_playlist_placeholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {result?.playlists.map(playlist => (
                    <SelectItem key={playlist.id} value={String(playlist.id)}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar className="size-6 rounded-md">
                          <AvatarImage src={playlist.cover} alt="" />
                          <AvatarFallback className="rounded-md"><ListMusicIcon className="size-3.5" /></AvatarFallback>
                        </Avatar>
                        <span className="truncate">{playlist.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t('ncm_track_count', { count: playlist.trackCount })}</span>
                        {playlist.subscribed && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">{t('ncm_subscribed')}</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
                {loading ? <Spinner /> : <RefreshCwIcon />}
                {t('ncm_load_playlists')}
              </Button>
            </div>
            {result && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar className="size-5">
                  <AvatarImage src={result.account.avatar} alt="" />
                  <AvatarFallback>{result.account.nickname.slice(0, 1)}</AvatarFallback>
                </Avatar>
                {t('ncm_account', { name: result.account.nickname, count: result.playlists.length })}
              </p>
            )}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </FormItem>
        )
      }}
    />
  )
}
