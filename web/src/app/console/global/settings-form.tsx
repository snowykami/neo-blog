'use client'

import type { SiteInfo } from '@/utils/common/siteinfo'
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { FormProvider, useForm, useFormContext } from 'react-hook-form'
import { toast } from 'sonner'
import { listKV, setKV } from '@/api/admin'
import { getSiteInfo } from '@/api/misc'
import { FileSelector } from '@/components/common/file-selector'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useOperationT } from '@/hooks/use-translations'
import { getFileUri } from '@/utils/client/file'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

// 站点内置的配色方案，对应 app/styles 下的主题文件
const ALL_COLOR_SCHEMES = fallbackSiteInfo.colorSchemes
// RSS 语言代码
const RSS_LANGUAGES = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ko-kr', 'de-de', 'fr-fr', 'es-es', 'pt-br', 'ru-ru', 'hi-in']

interface SettingsValues {
  siteName: string
  siteDescription: string
  siteIcon: string
  baseUrl: string
  keywords: string[]
  defaultCovers: string[]
  ownerName: string
  ownerDescription: string
  ownerMotto: string
  ownerAvatar: string
  ownerGravatarEmail: string
  colorSchemes: string[]
  defaultColorScheme: string
  animationDurationSecond: number
  postsPerPage: number
  commentsPerPage: number
  maxReplyDepth: number
  copyright: string
  copyrightLink: string
  footerText: string
  footerLinks: { text: string, href: string }[]
  enableRegister: boolean
  enableRegisterFromOidc: boolean
  verifyCodeCoolDown: number
  visitLogRetentionDays: number
  rssTitle: string
  rssAuthor: string
  rssCopyright: string
  rssImage: string
  rssLanguage: string
  aboutBackground: string
  sidebarIframeUrl: string
  sidebarIframeTitle: string
  musicPlaylistUrl: string
  enableThirdPartyScript: boolean
  aiApiBaseUrl: string
  aiApiKey: string
  aiModel: string
}

type FieldName = keyof SettingsValues

// 写入 site_info 整体配置（前台展示用）的字段
const SITE_INFO_FIELDS: FieldName[] = [
  'siteName',
  'siteDescription',
  'siteIcon',
  'baseUrl',
  'keywords',
  'defaultCovers',
  'ownerName',
  'ownerDescription',
  'ownerMotto',
  'ownerAvatar',
  'ownerGravatarEmail',
  'colorSchemes',
  'defaultColorScheme',
  'animationDurationSecond',
  'postsPerPage',
  'commentsPerPage',
  'copyright',
  'copyrightLink',
  'footerText',
  'footerLinks',
  'verifyCodeCoolDown',
  'aboutBackground',
  'sidebarIframeUrl',
  'sidebarIframeTitle',
  'musicPlaylistUrl',
  'enableThirdPartyScript',
]

// 同时写入后端独立配置键的字段（后端邮件、OIDC 回调、RSS、评论等直接读取这些键）
const STANDALONE_KEYS: Partial<Record<FieldName, { key: string, toValue?: (values: SettingsValues) => unknown }>> = {
  siteName: { key: 'site_name' },
  siteDescription: { key: 'site_description' },
  siteIcon: { key: 'site_icon' },
  baseUrl: { key: 'base_url' },
  // RSS 的默认封面只支持单张，取第一张
  defaultCovers: { key: 'default_cover', toValue: values => values.defaultCovers[0] ?? '' },
  maxReplyDepth: { key: 'max_reply_depth' },
  enableRegister: { key: 'enable_register' },
  enableRegisterFromOidc: { key: 'enable_register_from_oidc' },
  visitLogRetentionDays: { key: 'visit_log_retention_days' },
  rssTitle: { key: 'site_title' },
  rssAuthor: { key: 'site_author' },
  rssCopyright: { key: 'site_copyright' },
  rssImage: { key: 'site_image' },
  rssLanguage: { key: 'default_language' },
  // AI 配置仅后端使用，属于敏感信息，只写入独立配置键，不进入 site_info
  aiApiBaseUrl: { key: 'ai_api_base_url', toValue: values => values.aiApiBaseUrl.trim() },
  aiApiKey: { key: 'ai_api_key', toValue: values => values.aiApiKey.trim() },
  aiModel: { key: 'ai_model', toValue: values => values.aiModel.trim() },
}

function toValues(info: SiteInfo, kv: Record<string, unknown>): SettingsValues {
  const str = (key: string, fallback: string) => (typeof kv[key] === 'string' ? kv[key] as string : fallback)
  const num = (key: string, fallback: number) => (typeof kv[key] === 'number' ? kv[key] as number : fallback)
  const bool = (key: string, fallback: boolean) => (typeof kv[key] === 'boolean' ? kv[key] as boolean : fallback)
  return {
    siteName: info.metadata.name,
    siteDescription: info.metadata.description,
    siteIcon: info.metadata.icon,
    baseUrl: info.baseUrl ?? '',
    keywords: info.keywords ?? [],
    defaultCovers: Array.isArray(info.defaultCover) ? info.defaultCover : info.defaultCover ? [info.defaultCover] : [],
    ownerName: info.owner.name,
    ownerDescription: info.owner.description ?? '',
    ownerMotto: info.owner.motto ?? '',
    ownerAvatar: info.owner.avatar ?? '',
    ownerGravatarEmail: info.owner.gravatarEmail ?? '',
    colorSchemes: info.colorSchemes,
    defaultColorScheme: info.defaultColorScheme,
    animationDurationSecond: info.animationDurationSecond,
    postsPerPage: info.postsPerPage,
    commentsPerPage: info.commentsPerPage,
    // 以下为后端独立配置，默认值与后端保持一致
    maxReplyDepth: num('maxReplyDepth', 3),
    copyright: info.copyright ?? '',
    copyrightLink: info.copyrightLink ?? '',
    footerText: info.footer.text ?? '',
    footerLinks: info.footer.links ?? [],
    enableRegister: bool('enableRegister', false),
    enableRegisterFromOidc: bool('enableRegisterFromOidc', true),
    verifyCodeCoolDown: info.verifyCodeCoolDown,
    visitLogRetentionDays: num('visitLogRetentionDays', 90),
    rssTitle: str('siteTitle', ''),
    rssAuthor: str('siteAuthor', ''),
    rssCopyright: str('siteCopyright', ''),
    rssImage: str('siteImage', ''),
    rssLanguage: str('defaultLanguage', 'zh-cn'),
    // 未保存过的个性化字段使用前台默认值，避免保存其他字段时被清空
    aboutBackground: info.aboutBackground ?? fallbackSiteInfo.aboutBackground ?? '',
    sidebarIframeUrl: info.sidebarIframeUrl ?? fallbackSiteInfo.sidebarIframeUrl ?? '',
    sidebarIframeTitle: info.sidebarIframeTitle ?? fallbackSiteInfo.sidebarIframeTitle ?? '',
    musicPlaylistUrl: info.musicPlaylistUrl ?? fallbackSiteInfo.musicPlaylistUrl ?? '',
    enableThirdPartyScript: info.enableThirdPartyScript ?? fallbackSiteInfo.enableThirdPartyScript ?? false,
    aiApiBaseUrl: str('aiApiBaseUrl', ''),
    aiApiKey: str('aiApiKey', ''),
    aiModel: str('aiModel', ''),
  }
}

// 在原 site_info 基础上覆盖表单字段，保留表单未涉及的字段
function toSiteInfo(base: SiteInfo, values: SettingsValues): SiteInfo {
  return {
    ...base,
    metadata: { ...base.metadata, name: values.siteName, description: values.siteDescription, icon: values.siteIcon },
    baseUrl: values.baseUrl,
    keywords: values.keywords,
    defaultCover: values.defaultCovers,
    owner: {
      ...base.owner,
      name: values.ownerName,
      description: values.ownerDescription,
      motto: values.ownerMotto,
      avatar: values.ownerAvatar,
      gravatarEmail: values.ownerGravatarEmail,
    },
    colorSchemes: values.colorSchemes,
    defaultColorScheme: values.defaultColorScheme,
    animationDurationSecond: Number(values.animationDurationSecond),
    postsPerPage: Number(values.postsPerPage),
    commentsPerPage: Number(values.commentsPerPage),
    copyright: values.copyright,
    copyrightLink: values.copyrightLink,
    footer: { ...base.footer, text: values.footerText, links: values.footerLinks.filter(link => link.text || link.href) },
    verifyCodeCoolDown: Number(values.verifyCodeCoolDown),
    aboutBackground: values.aboutBackground.trim(),
    sidebarIframeUrl: values.sidebarIframeUrl.trim(),
    sidebarIframeTitle: values.sidebarIframeTitle.trim(),
    musicPlaylistUrl: values.musicPlaylistUrl.trim(),
    enableThirdPartyScript: values.enableThirdPartyScript,
  }
}

/**
 * 全局配置表单：按用途分组，开关、数字、选择、图片等字段使用对应控件
 * 只保存修改过的字段，未修改的独立配置键不会被写入，避免覆盖环境变量提供的默认值
 */
export function SettingsForm() {
  const t = useTranslations('Console.global')
  const operationT = useOperationT()
  const { setSiteInfo } = useSiteInfo()
  const [baseSiteInfo, setBaseSiteInfo] = useState<SiteInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const form = useForm<SettingsValues>()

  useEffect(() => {
    Promise.all([getSiteInfo(), listKV('')])
      .then(([infoRes, kvRes]) => {
        const kv = Object.fromEntries(kvRes.data.items.map(item => [item.key, item.value]))
        // 响应层已把键名转为 camelCase，这里用 camelCase 读取独立配置
        const camelKv = Object.fromEntries(Object.entries(kv).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]))
        setBaseSiteInfo(infoRes.data)
        form.reset(toValues(infoRes.data, camelKv))
      })
      .catch(() => toast.error(operationT('fetch_failed')))
  }, [form, operationT])

  const onSubmit = async (values: SettingsValues) => {
    if (!baseSiteInfo)
      return
    const dirty = form.formState.dirtyFields as Partial<Record<FieldName, unknown>>
    const tasks: Promise<unknown>[] = []
    const nextSiteInfo = toSiteInfo(baseSiteInfo, values)
    if (SITE_INFO_FIELDS.some(field => dirty[field]))
      tasks.push(setKV({ key: 'site_info', value: nextSiteInfo }))
    for (const [field, target] of Object.entries(STANDALONE_KEYS) as [FieldName, NonNullable<typeof STANDALONE_KEYS[FieldName]>][]) {
      if (dirty[field])
        tasks.push(setKV({ key: target.key, value: target.toValue ? target.toValue(values) : values[field] }))
    }
    if (tasks.length === 0) {
      toast.info(t('no_changes'))
      return
    }
    setSaving(true)
    try {
      await Promise.all(tasks)
      toast.success(operationT('save_success'))
      setBaseSiteInfo(nextSiteInfo)
      setSiteInfo(nextSiteInfo)
      form.reset(values)
    }
    catch {
      toast.error(operationT('save_failed'))
    }
    finally {
      setSaving(false)
    }
  }

  if (!baseSiteInfo)
    return <p className="py-8 text-center text-muted-foreground">{t('loading')}</p>

  return (
    <FormProvider {...form}>
      {/* 关闭浏览器原生校验：type=url 会拒绝站内相对链接、小数 step 会拦截已有取值，导致点击保存无反应；输入类型仍保留以适配移动端键盘 */}
      <form noValidate className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Section title={t('section_site')} description={t('section_site_desc')}>
          <TextField name="siteName" label={t('site_name')} />
          <UrlField name="baseUrl" label={t('base_url')} description={t('base_url_desc')} />
          <TextAreaField name="siteDescription" label={t('site_description')} wide />
          <ImageField name="siteIcon" label={t('site_icon')} />
          <StringListField name="keywords" label={t('keywords')} placeholder={t('keyword_placeholder')} />
          <ImageListField name="defaultCovers" label={t('default_covers')} description={t('default_covers_desc')} />
        </Section>

        <Section title={t('section_owner')}>
          <TextField name="ownerName" label={t('owner_name')} />
          <TextField name="ownerMotto" label={t('owner_motto')} />
          <TextAreaField name="ownerDescription" label={t('owner_description')} wide />
          <ImageField name="ownerAvatar" label={t('owner_avatar')} />
          <TextField name="ownerGravatarEmail" label={t('owner_gravatar_email')} type="email" description={t('owner_gravatar_email_desc')} />
        </Section>

        <Section title={t('section_appearance')}>
          <ColorSchemesField />
          <NumberField name="animationDurationSecond" label={t('animation_duration')} description={t('animation_duration_desc')} min={0} max={3} step="any" />
        </Section>

        <Section title={t('section_content')}>
          <NumberField name="postsPerPage" label={t('posts_per_page')} min={1} max={100} />
          <NumberField name="commentsPerPage" label={t('comments_per_page')} min={1} max={100} />
          <NumberField name="maxReplyDepth" label={t('max_reply_depth')} description={t('max_reply_depth_desc')} min={1} max={10} />
          <TextField name="copyright" label={t('copyright')} placeholder="CC BY-NC-SA 4.0" />
          <UrlField name="copyrightLink" label={t('copyright_link')} />
        </Section>

        <Section title={t('section_personalize')} description={t('section_personalize_desc')}>
          <ImageField name="aboutBackground" label={t('about_background')} description={t('empty_to_hide')} />
          <UrlField name="sidebarIframeUrl" label={t('sidebar_iframe_url')} description={t('sidebar_iframe_url_desc')} />
          <TextField name="sidebarIframeTitle" label={t('sidebar_iframe_title')} placeholder="Misskey" />
          <UrlField name="musicPlaylistUrl" label={t('music_playlist_url')} description={t('music_playlist_url_desc')} />
          <SwitchField name="enableThirdPartyScript" label={t('enable_third_party_script')} description={t('enable_third_party_script_desc')} />
        </Section>

        <Section title={t('section_footer')}>
          <TextField name="footerText" label={t('footer_text')} wide />
          <LinkListField name="footerLinks" label={t('footer_links')} />
        </Section>

        <Section title={t('section_account')}>
          <SwitchField name="enableRegister" label={t('enable_register')} description={t('enable_register_desc')} />
          <SwitchField name="enableRegisterFromOidc" label={t('enable_register_from_oidc')} description={t('enable_register_from_oidc_desc')} />
          <NumberField name="verifyCodeCoolDown" label={t('verify_code_cool_down')} description={t('seconds')} min={10} max={3600} />
        </Section>

        <Section title={t('section_visit')}>
          <NumberField name="visitLogRetentionDays" label={t('visit_log_retention_days')} description={t('visit_log_retention_days_desc')} min={1} max={3650} />
        </Section>

        <Section title={t('section_ai')} description={t('section_ai_desc')}>
          <UrlField name="aiApiBaseUrl" label={t('ai_api_base_url')} description={t('ai_api_base_url_desc')} placeholder="https://api.openai.com/v1" />
          <TextField name="aiModel" label={t('ai_model')} description={t('ai_model_desc')} placeholder="gpt-4o-mini / deepseek-chat" />
          <PasswordField name="aiApiKey" label={t('ai_api_key')} description={t('ai_api_key_desc')} wide />
        </Section>

        <Section title={t('section_rss')} description={t('section_rss_desc')}>
          <TextField name="rssTitle" label={t('rss_title')} />
          <TextField name="rssAuthor" label={t('rss_author')} />
          <TextField name="rssCopyright" label={t('rss_copyright')} />
          <SelectField name="rssLanguage" label={t('rss_language')} options={RSS_LANGUAGES.map(code => ({ value: code, label: code }))} />
          <ImageField name="rssImage" label={t('rss_image')} />
        </Section>

        {/* 保存栏：滚动时固定在底部 */}
        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t bg-background/90 py-3 backdrop-blur">
          {form.formState.isDirty && <span className="text-sm text-muted-foreground">{t('unsaved_changes')}</span>}
          <Button type="button" variant="outline" disabled={!form.formState.isDirty || saving} onClick={() => form.reset()}>
            {t('reset')}
          </Button>
          <Button type="submit" disabled={!form.formState.isDirty || saving}>
            {saving ? t('saving') : operationT('save')}
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}

function Section({ title, description, children }: { title: string, description?: string, children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid items-start gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  )
}

interface FieldProps {
  name: FieldName
  label: string
  description?: string
  placeholder?: string
  wide?: boolean // 占满整行
}

function TextField({ name, label, description, placeholder, wide, type = 'text' }: FieldProps & { type?: string }) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={wide ? 'md:col-span-2' : undefined}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} placeholder={placeholder} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function UrlField(props: FieldProps) {
  return <TextField {...props} type="url" placeholder={props.placeholder ?? 'https://'} />
}

// 密钥类输入：默认以密码形式隐藏，可切换显示
function PasswordField({ name, label, description, placeholder, wide }: FieldProps) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<SettingsValues>()
  const [visible, setVisible] = useState(false)
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={wide ? 'md:col-span-2' : undefined}>
          <FormLabel>{label}</FormLabel>
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
              aria-label={visible ? t('hide_secret') : t('show_secret')}
              title={visible ? t('hide_secret') : t('show_secret')}
              onClick={() => setVisible(v => !v)}
            >
              {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </Button>
          </div>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function TextAreaField({ name, label, description, wide }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={wide ? 'md:col-span-2' : undefined}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea rows={3} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function NumberField({ name, label, description, min, max, step = 1 }: FieldProps & { min?: number, max?: number, step?: number | 'any' }) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={min}
              max={max}
              step={step}
              value={(field.value as number) ?? ''}
              onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
              onBlur={field.onBlur}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function SwitchField({ name, label, description }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 md:col-span-2">
          <div className="grid gap-1">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

function SelectField({ name, label, description, options }: FieldProps & { options: { value: string, label: React.ReactNode }[] }) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

// 图片：可直接填写地址，也可从文件库选择，并显示预览
function ImageInput({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const t = useTranslations('Console.global')
  return (
    <div className="flex items-center gap-2">
      <div className="size-9 shrink-0 overflow-hidden rounded-md border">
        <SafeImage src={value || null} alt="" width={36} height={36} className="size-full object-cover" fallback={<div className="size-full bg-muted" />} />
      </div>
      <Input type="url" placeholder="https://" value={value ?? ''} onChange={e => onChange(e.target.value)} />
      <FileSelector limitNumber={1} limitType={['image/*']} onFilesSelected={files => files[0] && onChange(getFileUri(files[0].id))}>
        <Button type="button" variant="outline">{t('choose_file')}</Button>
      </FileSelector>
    </div>
  )
}

function ImageField({ name, label, description }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <ImageInput value={field.value as string} onChange={field.onChange} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

// 可增删的列表字段，renderItem 负责单项的输入控件
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

function StringListField({ name, label, description, placeholder }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>{label}</FormLabel>
          <ListEditor<string>
            items={(field.value as string[]) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(item, update) => <Input placeholder={placeholder} value={item} onChange={e => update(e.target.value)} />}
          />
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function ImageListField({ name, label, description }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>{label}</FormLabel>
          <ListEditor<string>
            items={(field.value as string[]) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(item, update) => <ImageInput value={item} onChange={update} />}
          />
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  )
}

function LinkListField({ name, label }: FieldProps) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>{label}</FormLabel>
          <ListEditor<{ text: string, href: string }>
            items={(field.value as { text: string, href: string }[]) ?? []}
            onChange={field.onChange}
            createItem={() => ({ text: '', href: '' })}
            renderItem={(item, update) => (
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <Input placeholder={t('link_text')} value={item.text} onChange={e => update({ ...item, text: e.target.value })} />
                <Input type="url" placeholder="https://" value={item.href} onChange={e => update({ ...item, href: e.target.value })} />
              </div>
            )}
          />
        </FormItem>
      )}
    />
  )
}

// 配色：勾选允许用户切换的配色，并从中选择默认配色；色块直接使用对应主题的主色
function ColorSchemesField() {
  const t = useTranslations('Console.global')
  const { control, watch } = useFormContext<SettingsValues>()
  const enabled = watch('colorSchemes') ?? []
  const swatch = (scheme: string) => <span data-user-color={scheme} className="inline-block size-4 shrink-0 rounded-full bg-primary ring-1 ring-border" />
  return (
    <>
      <FormField
        control={control}
        name="colorSchemes"
        render={({ field }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>{t('color_schemes')}</FormLabel>
            <div className="flex flex-wrap gap-2">
              {ALL_COLOR_SCHEMES.map((scheme) => {
                const checked = (field.value as string[]).includes(scheme)
                return (
                  <label key={scheme} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${checked ? 'border-primary' : ''}`}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={next => field.onChange(next
                        ? ALL_COLOR_SCHEMES.filter(item => item === scheme || (field.value as string[]).includes(item))
                        : (field.value as string[]).filter(item => item !== scheme))}
                    />
                    {swatch(scheme)}
                    {scheme}
                  </label>
                )
              })}
            </div>
            <FormDescription>{t('color_schemes_desc')}</FormDescription>
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="defaultColorScheme"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('default_color_scheme')}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              </FormControl>
              <SelectContent>
                {(enabled.length > 0 ? enabled : ALL_COLOR_SCHEMES).map(scheme => (
                  <SelectItem key={scheme} value={scheme}>
                    <span className="flex items-center gap-2">
                      {swatch(scheme)}
                      {scheme}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
    </>
  )
}
