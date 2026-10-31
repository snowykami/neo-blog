'use client'

import type { SidebarCardConfig } from '@/components/blog-sidebar/sidebar-cards'
import type { MusicSourceType, NCMPlaylists, NCMSongLevel } from '@/models/music'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { EyeIcon, EyeOffIcon, ImageIcon, ListMusicIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { getEnvOverrides, listKV, setKV } from '@/api/admin'
import { getSiteInfo } from '@/api/misc'
import { listNCMPlaylists } from '@/api/music'
import { defaultSidebarCards } from '@/components/blog-sidebar/sidebar-cards'
import { AssetField } from '@/components/common/asset-picker'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { ThemePackPreviewField } from '@/components/console/theme-pack-preview'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { NCM_SONG_LEVELS } from '@/models/music'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { SidebarCardsField } from './sidebar-cards-field'

// 站点内置的配色方案，对应 app/styles 下的主题文件
const ALL_COLOR_SCHEMES = fallbackSiteInfo.colorSchemes
// RSS 语言代码，与界面支持的语言保持一致（zh / zh-tw / ja / en / ko）
const RSS_LANGUAGES = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ko-kr']

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
  pageBackgroundImage: string
  pageBackgroundBlur: number
  pageBackgroundOpacity: number
  pageBackgroundVeil: number
  pageBackgroundVeilColor: string
  pageBackgroundDecorations: boolean
  postsPerPage: number
  commentsPerPage: number
  maxReplyDepth: number
  revisionMaxKeep: number
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
  sidebarCards: SidebarCardConfig[]
  musicSource: MusicSourceType
  musicPlaylistUrl: string
  ncmApiBaseUrl: string
  musicTtmlUrlTemplate: string
  ncmCookie: string
  ncmPlaylistId: number
  ncmSongLevel: NCMSongLevel
  qweatherApiHost: string
  qweatherApiKey: string
  enableThirdPartyScript: boolean
  aiApiBaseUrl: string
  aiApiKey: string
  aiModel: string
  aiSummaryConcurrency: number
  aiWritingStyle: string
  lyricAnnotationTtlDays: number
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
  'sidebarCards',
  'musicSource',
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
  revisionMaxKeep: { key: 'revision_max_keep' },
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
  aiSummaryConcurrency: { key: 'ai_summary_concurrency' },
  aiWritingStyle: { key: 'ai_writing_style', toValue: values => values.aiWritingStyle.trim() },
  lyricAnnotationTtlDays: { key: 'lyric_annotation_ttl_days' },
  // 网易云 API 与 Cookie 仅后端使用，同样只写入独立配置键
  ncmApiBaseUrl: { key: 'ncm_api_base_url', toValue: values => values.ncmApiBaseUrl.trim() },
  ncmCookie: { key: 'ncm_cookie', toValue: values => values.ncmCookie.trim() },
  ncmPlaylistId: { key: 'ncm_playlist_id' },
  ncmSongLevel: { key: 'ncm_song_level' },
  // 自定义 TTML 歌词源地址（环境变量 MUSIC_TTML_URL_PREFIX 优先）
  musicTtmlUrlTemplate: { key: 'music_ttml_url_template', toValue: values => values.musicTtmlUrlTemplate.trim() },
  // 和风天气配置仅后端使用，Key 只写入独立配置键
  qweatherApiHost: { key: 'qweather_api_host', toValue: values => values.qweatherApiHost.trim() },
  qweatherApiKey: { key: 'qweather_api_key', toValue: values => values.qweatherApiKey.trim() },
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
    pageBackgroundImage: info.pageBackground?.image ?? '',
    pageBackgroundBlur: info.pageBackground?.blur ?? 0,
    pageBackgroundOpacity: info.pageBackground?.opacity ?? 1,
    pageBackgroundVeil: info.pageBackground?.veil ?? 0.72,
    pageBackgroundVeilColor: info.pageBackground?.veilColor ?? '',
    pageBackgroundDecorations: info.pageBackground?.decorations ?? true,
    postsPerPage: info.postsPerPage,
    commentsPerPage: info.commentsPerPage,
    // 以下为后端独立配置，默认值与后端保持一致
    maxReplyDepth: num('maxReplyDepth', 3),
    revisionMaxKeep: num('revisionMaxKeep', 50),
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
    // 未配置过侧边栏卡片时，按前台默认卡片（含旧的嵌入页面配置）展示
    sidebarCards: info.sidebarCards ?? defaultSidebarCards({
      sidebarIframeUrl: info.sidebarIframeUrl ?? fallbackSiteInfo.sidebarIframeUrl,
      sidebarIframeTitle: info.sidebarIframeTitle ?? fallbackSiteInfo.sidebarIframeTitle,
    }),
    musicSource: info.musicSource ?? 'static',
    musicPlaylistUrl: info.musicPlaylistUrl ?? fallbackSiteInfo.musicPlaylistUrl ?? '',
    ncmApiBaseUrl: str('ncmApiBaseUrl', ''),
    ncmCookie: str('ncmCookie', ''),
    ncmPlaylistId: num('ncmPlaylistId', 0),
    ncmSongLevel: NCM_SONG_LEVELS.find(level => level === kv.ncmSongLevel) ?? 'exhigh',
    musicTtmlUrlTemplate: str('musicTtmlUrlTemplate', ''),
    qweatherApiHost: str('qweatherApiHost', ''),
    qweatherApiKey: str('qweatherApiKey', ''),
    enableThirdPartyScript: info.enableThirdPartyScript ?? fallbackSiteInfo.enableThirdPartyScript ?? false,
    aiApiBaseUrl: str('aiApiBaseUrl', ''),
    aiApiKey: str('aiApiKey', ''),
    aiModel: str('aiModel', ''),
    aiSummaryConcurrency: num('aiSummaryConcurrency', 3),
    aiWritingStyle: str('aiWritingStyle', ''),
    lyricAnnotationTtlDays: num('lyricAnnotationTtlDays', 7),
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
    pageBackground: {
      // 单独一栏「背景图」即可：填了就铺满非内容区，清空就回到纯色背景
      enabled: true,
      image: (values.pageBackgroundImage ?? '').trim(),
      blur: Number(values.pageBackgroundBlur) || 0,
      opacity: Number.isNaN(Number(values.pageBackgroundOpacity)) ? 1 : Number(values.pageBackgroundOpacity),
      veil: Number.isNaN(Number(values.pageBackgroundVeil)) ? 0.72 : Number(values.pageBackgroundVeil),
      veilColor: (values.pageBackgroundVeilColor ?? '').trim(),
      decorations: values.pageBackgroundDecorations,
    },
    postsPerPage: Number(values.postsPerPage),
    commentsPerPage: Number(values.commentsPerPage),
    copyright: values.copyright,
    copyrightLink: values.copyrightLink,
    footer: { ...base.footer, text: values.footerText, links: values.footerLinks.filter(link => link.text || link.href) },
    verifyCodeCoolDown: Number(values.verifyCodeCoolDown),
    aboutBackground: values.aboutBackground.trim(),
    sidebarCards: values.sidebarCards,
    musicSource: values.musicSource,
    musicPlaylistUrl: values.musicPlaylistUrl.trim(),
    enableThirdPartyScript: values.enableThirdPartyScript,
  }
}

// 页内 Tab 及其包含的字段（用于标记有未保存修改的 Tab、校验失败时定位）；advanced 为原始键值编辑，不属于表单
const SETTINGS_TABS = ['site', 'content', 'frontend', 'account', 'ai', 'rss'] as const
const GLOBAL_TABS = [...SETTINGS_TABS, 'advanced'] as const
type SettingsTab = typeof SETTINGS_TABS[number]
type GlobalTab = typeof GLOBAL_TABS[number]

const TAB_FIELDS: Record<SettingsTab, FieldName[]> = {
  site: ['siteName', 'baseUrl', 'siteDescription', 'siteIcon', 'keywords', 'defaultCovers', 'ownerName', 'ownerMotto', 'ownerDescription', 'ownerAvatar', 'ownerGravatarEmail'],
  content: ['colorSchemes', 'defaultColorScheme', 'animationDurationSecond', 'pageBackgroundImage', 'pageBackgroundBlur', 'pageBackgroundOpacity', 'pageBackgroundVeil', 'pageBackgroundVeilColor', 'pageBackgroundDecorations', 'postsPerPage', 'commentsPerPage', 'maxReplyDepth', 'revisionMaxKeep', 'copyright', 'copyrightLink', 'footerText', 'footerLinks'],
  frontend: ['aboutBackground', 'sidebarCards', 'enableThirdPartyScript', 'musicSource', 'musicPlaylistUrl', 'ncmApiBaseUrl', 'ncmCookie', 'ncmPlaylistId', 'ncmSongLevel', 'musicTtmlUrlTemplate', 'qweatherApiHost', 'qweatherApiKey'],
  account: ['enableRegister', 'enableRegisterFromOidc', 'verifyCodeCoolDown', 'visitLogRetentionDays'],
  ai: ['aiApiBaseUrl', 'aiApiKey', 'aiModel', 'aiSummaryConcurrency', 'aiWritingStyle', 'lyricAnnotationTtlDays'],
  rss: ['rssTitle', 'rssAuthor', 'rssCopyright', 'rssLanguage', 'rssImage'],
}

/**
 * 全局配置表单：按用途分组，开关、数字、选择、图片等字段使用对应控件
 * 只保存修改过的字段，未修改的独立配置键不会被写入，避免覆盖环境变量提供的默认值
 */
export function SettingsForm({ advanced }: { advanced: React.ReactNode }) {
  const t = useTranslations('Console.global')
  const operationT = useOperationT()
  const { setSiteInfo } = useSiteInfo()
  const [baseSiteInfo, setBaseSiteInfo] = useState<SiteInfo | null>(null)
  const [saving, setSaving] = useState(false)
  // 由环境变量设置的配置（只读显示），键为 camelCase 的字段名
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({})
  const form = useForm<SettingsValues>()
  // 当前 Tab 写入地址参数，便于直接打开某个分组
  const [tab, setTab] = useQueryState('tab', parseAsStringEnum<GlobalTab>([...GLOBAL_TABS]).withDefault('site').withOptions({ history: 'replace', clearOnDefault: true }))

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
    // 读取失败时按没有环境变量处理，不影响编辑
    getEnvOverrides()
      .then(res => setEnvOverrides(res.data.overrides ?? {}))
      .catch(() => {})
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

  // 有校验错误时切到第一个出错字段所在的 Tab
  const onInvalid = (errors: Partial<Record<FieldName, unknown>>) => {
    const field = Object.keys(errors)[0] as FieldName | undefined
    const target = SETTINGS_TABS.find(key => field && TAB_FIELDS[key].includes(field))
    if (target)
      void setTab(target)
  }

  if (!baseSiteInfo)
    return <p className="py-8 text-center text-muted-foreground">{t('loading')}</p>

  const dirtyFields = form.formState.dirtyFields as Partial<Record<FieldName, unknown>>
  return (
    <FormProvider {...form}>
      <Tabs value={tab} onValueChange={value => void setTab(value as GlobalTab)} className="gap-4">
        {/* 窄屏时横向滚动 */}
        <TabsList variant="underline" className="w-full justify-start">
          {GLOBAL_TABS.map(key => (
            <TabsTrigger key={key} value={key} className="flex-none px-3">
              {t(`tab_${key}`)}
              {key !== 'advanced' && TAB_FIELDS[key].some(field => dirtyFields[field]) && (
                <span role="img" aria-label={t('unsaved_changes')} className="size-1.5 rounded-full bg-primary" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* 关闭浏览器原生校验：type=url 会拒绝站内相对链接、小数 step 会拦截已有取值，导致点击保存无反应；输入类型仍保留以适配移动端键盘 */}
        {/* 设置类 Tab 始终挂载、只做隐藏，共用一个表单与保存栏，切换 Tab 不会丢失未保存的修改；高级键值编辑在表单之外 */}
        <form noValidate className={cn('grid gap-4', tab === 'advanced' && 'hidden')} onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
          <TabsContent value="site" forceMount className="grid gap-4 data-[state=inactive]:hidden">
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
          </TabsContent>
          <TabsContent value="content" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <Section title={t('section_appearance')}>
              <ThemePackPreviewField />
              <ColorSchemesField />
              <NumberField name="animationDurationSecond" label={t('animation_duration')} description={t('animation_duration_desc')} min={0} max={3} step="any" />
              <div className="flex items-center gap-2 pt-2 text-sm font-semibold text-muted-foreground md:col-span-2">
                <ImageIcon aria-hidden className="size-4" />
                {t('page_background')}
              </div>
              <ImageField name="pageBackgroundImage" label={t('page_background_image')} description={t('page_background_image_desc')} />
              <SwitchField name="pageBackgroundDecorations" label={t('page_background_decorations')} description={t('page_background_decorations_desc')} />
              <NumberField name="pageBackgroundBlur" label={t('page_background_blur')} description={t('page_background_blur_desc')} min={0} max={40} />
              <NumberField name="pageBackgroundOpacity" label={t('page_background_opacity')} description={t('page_background_opacity_desc')} min={0} max={1} step={0.05} />
              <NumberField name="pageBackgroundVeil" label={t('page_background_veil')} description={t('page_background_veil_desc')} min={0} max={1} step={0.05} />
              <ColorField name="pageBackgroundVeilColor" label={t('page_background_veil_color')} description={t('page_background_veil_color_desc')} />
            </Section>

            <Section title={t('section_content')}>
              <NumberField name="postsPerPage" label={t('posts_per_page')} min={1} max={100} />
              <NumberField name="commentsPerPage" label={t('comments_per_page')} min={1} max={100} />
              <NumberField name="maxReplyDepth" label={t('max_reply_depth')} description={t('max_reply_depth_desc')} min={1} max={10} />
              <NumberField name="revisionMaxKeep" label={t('revision_max_keep')} description={t('revision_max_keep_desc')} min={10} max={500} />
              <TextField name="copyright" label={t('copyright')} placeholder="CC BY-NC-SA 4.0" />
              <UrlField name="copyrightLink" label={t('copyright_link')} />
            </Section>

            <Section title={t('section_footer')}>
              <TextField name="footerText" label={t('footer_text')} wide />
              <LinkListField name="footerLinks" label={t('footer_links')} />
            </Section>
          </TabsContent>
          <TabsContent value="frontend" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <Section title={t('section_personalize')} description={t('section_personalize_desc')}>
              <ImageField name="aboutBackground" label={t('about_background')} description={t('empty_to_hide')} />
              <SwitchField name="enableThirdPartyScript" label={t('enable_third_party_script')} description={t('enable_third_party_script_desc')} />
            </Section>

            <Section title={t('section_sidebar')} description={t('section_sidebar_desc')}>
              <SidebarCardsField />
            </Section>

            <MusicSection envOverrides={envOverrides} />
            <Section title={t('section_weather')} description={t('section_weather_desc')}>
              <TextField name="qweatherApiHost" label={t('qweather_api_host')} description={t('qweather_api_host_desc')} placeholder="abc123xyz.re.qweatherapi.com" />
              <PasswordField name="qweatherApiKey" label={t('qweather_api_key')} description={t('qweather_api_key_desc')} />
            </Section>
          </TabsContent>
          <TabsContent value="account" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <Section title={t('section_account')}>
              <SwitchField name="enableRegister" label={t('enable_register')} description={t('enable_register_desc')} />
              <SwitchField name="enableRegisterFromOidc" label={t('enable_register_from_oidc')} description={t('enable_register_from_oidc_desc')} />
              <NumberField name="verifyCodeCoolDown" label={t('verify_code_cool_down')} description={t('seconds')} min={10} max={3600} />
            </Section>

            <Section title={t('section_visit')}>
              <NumberField name="visitLogRetentionDays" label={t('visit_log_retention_days')} description={t('visit_log_retention_days_desc')} min={1} max={3650} />
            </Section>
          </TabsContent>
          <TabsContent value="ai" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <Section title={t('section_ai')} description={t('section_ai_desc')}>
              <UrlField name="aiApiBaseUrl" label={t('ai_api_base_url')} description={t('ai_api_base_url_desc')} placeholder="https://api.openai.com/v1" />
              <TextField name="aiModel" label={t('ai_model')} description={t('ai_model_desc')} placeholder="gpt-4o-mini / deepseek-chat" />
              <PasswordField name="aiApiKey" label={t('ai_api_key')} description={t('ai_api_key_desc')} wide />
              <NumberField name="aiSummaryConcurrency" label={t('ai_summary_concurrency')} description={t('ai_summary_concurrency_desc')} min={1} max={20} />
              <TextAreaField name="aiWritingStyle" label={t('ai_writing_style')} description={t('ai_writing_style_desc')} placeholder={t('ai_writing_style_placeholder')} rows={6} wide />
              <NumberField name="lyricAnnotationTtlDays" label={t('lyric_annotation_ttl_days')} description={t('lyric_annotation_ttl_days_desc')} min={1} max={365} />
            </Section>
          </TabsContent>
          <TabsContent value="rss" forceMount className="grid gap-4 data-[state=inactive]:hidden">
            <Section title={t('section_rss')} description={t('section_rss_desc')}>
              <TextField name="rssTitle" label={t('rss_title')} />
              <TextField name="rssAuthor" label={t('rss_author')} />
              <TextField name="rssCopyright" label={t('rss_copyright')} />
              <SelectField name="rssLanguage" label={t('rss_language')} options={RSS_LANGUAGES.map(code => ({ value: code, label: code }))} />
              <ImageField name="rssImage" label={t('rss_image')} />
            </Section>
          </TabsContent>
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
        <TabsContent value="advanced">{advanced}</TabsContent>
      </Tabs>
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <Input type={type} placeholder={placeholder} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

// 可由环境变量覆盖的文本配置：环境变量设置时显示它的值（只读）并说明，否则正常编辑
function EnvOverridableField({ envValue, envNote, ...props }: FieldProps & { envValue?: string, envNote: string }) {
  if (!envValue)
    return <TextField {...props} />
  return (
    <FormItem className={props.wide ? 'md:col-span-2' : undefined}>
      <LabelWithInfo info={props.description}><FormLabel>{props.label}</FormLabel></LabelWithInfo>
      <Input value={envValue} readOnly disabled />
      <FormDescription>{envNote}</FormDescription>
    </FormItem>
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
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
        </FormItem>
      )}
    />
  )
}

function TextAreaField({ name, label, description, placeholder, wide, rows = 3 }: FieldProps & { rows?: number }) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={wide ? 'md:col-span-2' : undefined}>
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <Textarea rows={rows} placeholder={placeholder} {...field} value={(field.value as string) ?? ''} />
          </FormControl>
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
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
        </FormItem>
      )}
    />
  )
}

/** 颜色输入：原生取色器（只认 #rrggbb）+ 自由文本（可写 oklch() 等），留空表示跟随主题 */
function ColorField({ name, label, description, wide }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  const t = useTranslations('Console.global')
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string) ?? ''
        return (
          <FormItem className={wide ? 'md:col-span-2' : undefined}>
            <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
            <div className="flex gap-3">
              <Input
                type="color"
                aria-label={t('pick_color')}
                className="w-12 shrink-0 cursor-pointer p-1"
                value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
                onChange={e => field.onChange(e.target.value)}
              />
              <FormControl>
                <Input
                  {...field}
                  value={value}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('color_placeholder')}
                  className="font-mono"
                />
              </FormControl>
              {value && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('clear_color')}
                  title={t('clear_color')}
                  onClick={() => field.onChange('')}
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          </FormItem>
        )
      }}
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  )
}

// 图片：可直接填写地址，也可从资产库选择 / 本地上传，并显示预览
function ImageInput({ value, onChange, clearable = false }: { value: string, onChange: (value: string) => void, clearable?: boolean }) {
  return <AssetField value={value} onChange={onChange} clearable={clearable} placeholder="https://" />
}

function ImageField({ name, label, description }: FieldProps) {
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <FormControl>
            <ImageInput value={field.value as string} onChange={field.onChange} clearable />
          </FormControl>
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <ListEditor<string>
            items={(field.value as string[]) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(item, update) => <Input placeholder={placeholder} value={item} onChange={e => update(e.target.value)} />}
          />
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
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
          <ListEditor<string>
            items={(field.value as string[]) ?? []}
            onChange={field.onChange}
            createItem={() => ''}
            renderItem={(item, update) => <ImageInput value={item} onChange={update} />}
          />
        </FormItem>
      )}
    />
  )
}

function LinkListField({ name, label, description }: FieldProps) {
  const t = useTranslations('Console.global')
  const { control } = useFormContext<SettingsValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <LabelWithInfo info={description}><FormLabel>{label}</FormLabel></LabelWithInfo>
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

// 音乐播放器：歌单来源为静态 JSON 地址，或从网易云账号的歌单中选择；自定义 TTML 歌词源地址（环境变量设置时只读）
function MusicSection({ envOverrides }: { envOverrides: Record<string, string> }) {
  const t = useTranslations('Console.global')
  const source = useWatch<SettingsValues, 'musicSource'>({ name: 'musicSource' })
  return (
    <Section title={t('section_music')} description={t('section_music_desc')}>
      <SelectField
        name="musicSource"
        label={t('music_source')}
        options={[
          { value: 'static', label: t('music_source_static') },
          { value: 'ncm', label: t('music_source_ncm') },
        ]}
      />
      {source === 'ncm'
        ? (
            <>
              <UrlField name="ncmApiBaseUrl" label={t('ncm_api_base_url')} description={t('ncm_api_base_url_desc')} placeholder="https://ncm-api.example.com" />
              <PasswordField name="ncmCookie" label={t('ncm_cookie')} description={t('ncm_cookie_desc')} placeholder="MUSIC_U=..." wide />
              <NCMPlaylistField />
              <SelectField
                name="ncmSongLevel"
                label={t('ncm_song_level')}
                description={t('ncm_song_level_desc')}
                options={NCM_SONG_LEVELS.map(level => ({ value: level, label: t(`ncm_song_level_${level}`) }))}
              />
            </>
          )
        : <UrlField name="musicPlaylistUrl" label={t('music_playlist_url')} description={t('music_playlist_url_desc')} />}
      <EnvOverridableField
        name="musicTtmlUrlTemplate"
        label={t('music_ttml_url_template')}
        description={t('music_ttml_url_template_desc')}
        placeholder="https://cdn.example.com/lyrics/{song_id}.ttml"
        envValue={envOverrides.musicTtmlUrlTemplate}
        envNote={t('env_override_note', { name: 'MUSIC_TTML_URL_PREFIX' })}
        wide
      />
    </Section>
  )
}

// 网易云歌单：用当前填写的 API 地址与 Cookie 读取账号歌单（未保存也可以先读取），选择其一作为博客歌单
function NCMPlaylistField() {
  const t = useTranslations('Console.global')
  const errorMessageT = useErrorMessageT()
  const { control, getValues } = useFormContext<SettingsValues>()
  const [result, setResult] = useState<NCMPlaylists | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listNCMPlaylists({ apiBaseUrl: getValues('ncmApiBaseUrl').trim(), cookie: getValues('ncmCookie').trim() })
      setResult(res.data)
    }
    catch (err) {
      setResult(null)
      setError(errorMessageT(err, t('ncm_load_failed')))
    }
    finally {
      setLoading(false)
    }
  }, [getValues, errorMessageT, t])

  // 已保存配置时自动读取一次，以显示当前所选歌单的名称
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current)
      return
    autoLoaded.current = true
    if (getValues('ncmApiBaseUrl') && getValues('ncmCookie'))
      void load()
  }, [getValues, load])

  return (
    <FormField
      control={control}
      name="ncmPlaylistId"
      render={({ field }) => {
        const selectedId = Number(field.value) || 0
        const known = result?.playlists.some(playlist => playlist.id === selectedId)
        return (
          <FormItem className="md:col-span-2">
            <LabelWithInfo info={t('ncm_playlist_desc')}><FormLabel>{t('ncm_playlist')}</FormLabel></LabelWithInfo>
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
            <LabelWithInfo info={t('color_schemes_desc')}><FormLabel>{t('color_schemes')}</FormLabel></LabelWithInfo>
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
