'use client'

import type { ConfigValues } from './config-fields'
import type { ConfigItem, ConfigSchema } from '@/models/config'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { ArrowUpRightIcon, AudioLinesIcon, BotIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsString, useQueryState } from 'nuqs'
import { createContext, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, useFormContext, useFormState, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { getConfigSchema, saveConfig } from '@/api/admin'
import { getSiteInfo } from '@/api/misc'
import { defaultSidebarCards } from '@/components/blog-sidebar/sidebar-cards'
import { FormFloatingSaveBar } from '@/components/console/common/floating-save-bar'
import { ThemePackPreviewField } from '@/components/console/theme-pack-preview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { ConfigField, useConfigT } from './config-fields'
import { EmailTestField } from './email-test-field'
import { NotificationTestField } from './notification-test-field'
import { SearchTestField } from './search-test-field'

// 存为独立配置键的配置项，供「高级」Tab 的原始键值编辑快速选择
const StandaloneKeysContext = createContext<string[]>([])

export function useStandaloneConfigKeys() {
  return use(StandaloneKeysContext)
}

// 表单初始值：数据库中的值；侧边栏卡片未配置时按前台默认卡片展示（含旧的嵌入页面配置）
function toFormValues(schema: ConfigSchema, siteInfo: SiteInfo): ConfigValues {
  const values: ConfigValues = {}
  for (const item of schema.sections.flatMap(section => section.items)) {
    values[item.key] = item.widget === 'sidebar_cards' && item.value == null
      ? defaultSidebarCards({
          sidebarIframeUrl: siteInfo.sidebarIframeUrl ?? fallbackSiteInfo.sidebarIframeUrl,
          sidebarIframeTitle: siteInfo.sidebarIframeTitle ?? fallbackSiteInfo.sidebarIframeTitle,
        })
      : item.value
  }
  return values
}

// 按 showWhen 决定是否显示（如歌单来源为网易云时才显示网易云配置）；无条件显示项不订阅表单变化
const VisibleField = memo(({ item }: { item: ConfigItem }) => {
  if (!item.showWhen)
    return <ConfigField item={item} />
  return <ConditionalVisibleField item={item} showWhen={item.showWhen} />
})

/**
 * 全局配置表单：结构由后端配置注册表下发（分组、类型、文案的 i18n 键、取值范围、环境变量），按类型生成输入组件。
 * 只提交修改过的项；环境变量设置的项只读显示
 */
export function SettingsForm({ advanced }: { advanced: React.ReactNode }) {
  const t = useTranslations('Console.global')
  const tr = useConfigT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const { siteInfo, setSiteInfo } = useSiteInfo()
  const [schema, setSchema] = useState<ConfigSchema | null>(null)
  const [saving, setSaving] = useState(false)
  const form = useForm<ConfigValues>()
  // 当前 Tab 写入地址参数，便于直接打开某个分组；兼容旧书签中的 frontend / rss
  const [rawTab, setTab] = useQueryState('tab', parseAsString.withDefault('site').withOptions({ history: 'replace', clearOnDefault: true }))
  const tab = rawTab === 'frontend' ? 'appearance' : rawTab === 'rss' ? 'site' : rawTab
  // 只挂载访问过的设置 Tab：首屏免去挂载未访问分组与网易云等懒触发字段，已访问过的保留挂载以维持跨 Tab 校验规则与未保存输入
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(tab && tab !== 'advanced' ? [tab] : []))

  useEffect(() => {
    if (!tab || tab === 'advanced')
      return
    setVisitedTabs((prev) => {
      if (prev.has(tab))
        return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [tab])

  const selectTab = useCallback((next: string) => {
    if (next !== 'advanced') {
      setVisitedTabs((prev) => {
        if (prev.has(next))
          return prev
        const updated = new Set(prev)
        updated.add(next)
        return updated
      })
    }
    void setTab(next)
  }, [setTab])

  // 只在加载表单时读取站点信息（用于补全侧边栏默认卡片），保存后刷新站点信息不触发重新加载
  const siteInfoRef = useRef(siteInfo)
  useEffect(() => {
    siteInfoRef.current = siteInfo
  }, [siteInfo])

  const load = useCallback(async () => {
    const res = await getConfigSchema()
    setSchema(res.data)
    form.reset(toFormValues(res.data, siteInfoRef.current))
  }, [form])

  useEffect(() => {
    load().catch(() => toast.error(operationT('fetch_failed')))
  }, [load, operationT])

  const items = useMemo(() => schema?.sections.flatMap(section => section.items) ?? [], [schema])
  const standaloneKeys = useMemo(() => items.filter(item => item.standalone).map(item => item.key), [items])
  const tabOf = useCallback((key: string) => schema?.sections.find(section => section.items.some(item => item.key === key))?.tab, [schema])
  // 通过子组件 useFormState 局部订阅同步最新 dirtyFields，不在 SettingsForm 顶层读取 form.formState，
  // 从而保持 FormProvider Context 引用稳定、避免任意字段输入触发全表单重渲染
  const dirtyFieldsRef = useRef<Record<string, unknown>>({})

  const onSubmit = async (values: ConfigValues) => {
    const dirty = dirtyFieldsRef.current
    const changes = items.filter(item => dirty[item.key] && !item.envValue && !item.envSet).map(item => ({ key: item.key, value: values[item.key] }))
    if (changes.length === 0) {
      toast.info(t('no_changes'))
      return
    }
    setSaving(true)
    try {
      await saveConfig(changes)
      toast.success(operationT('save_success'))
      await load()
      // 前台展示用的站点信息也可能被修改
      getSiteInfo().then(res => setSiteInfo(res.data)).catch(() => {})
    }
    catch (err) {
      toast.error(errorMessageT(err, operationT('save_failed')))
    }
    finally {
      setSaving(false)
    }
  }

  // 有校验错误时切到第一个出错字段所在的 Tab
  const onInvalid = (errors: Record<string, unknown>) => {
    const target = tabOf(Object.keys(errors)[0] ?? '')
    if (target)
      selectTab(target)
  }

  if (!schema) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label={t('loading')}>
        <div className="flex h-10 items-center gap-4 border-b border-foreground/10 px-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-10" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="grid gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  const tabs = [...schema.tabs, { key: 'advanced', title: 'tab_advanced' }]
  return (
    <FormProvider {...form}>
      <StandaloneKeysContext value={standaloneKeys}>
        <Tabs value={tab} onValueChange={selectTab} className="gap-4">
          {/* 与后台其它页面顶部 ConsoleTabs 保持统一的底边横线风格，窄屏横向滚动 */}
          <TabsList variant="underline" className="w-full justify-start">
            {tabs.map(({ key, title }) => (
              <TabsTrigger key={key} value={key} className="flex-none px-3">
                {tr(title)}
                {key !== 'advanced' && <TabDirtyDot tabKey={key} tabOf={tabOf} label={t('unsaved_changes')} />}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* 关闭浏览器原生校验：type=url 会拒绝站内相对链接、小数 step 会拦截已有取值，导致点击保存无反应；输入类型仍保留以适配移动端键盘 */}
          {/* 已访问过的设置类 Tab 保持挂载、只做隐藏，共用一个表单与保存栏；未访问的 Tab 延后挂载 */}
          <form noValidate className={cn('grid gap-4', tab === 'advanced' && 'hidden')} onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
            {schema.tabs.map(({ key }) => {
              const mounted = key === tab || visitedTabs.has(key)
              return (
                <TabsContent key={key} value={key} forceMount={mounted || undefined} className="grid gap-4 data-[state=inactive]:hidden">
                  {mounted && schema.sections.filter(section => section.tab === key).map(section => (
                    <Section
                      key={section.key}
                      id={section.key}
                      title={tr(section.title) ?? section.key}
                      description={tr(section.description)}
                      headerAction={<SectionHeaderAction name={section.widget} />}
                    >
                      <SectionWidget name={section.widget} items={section.items} />
                      {section.items.map(item => <VisibleField key={item.key} item={item} />)}
                    </Section>
                  ))}
                </TabsContent>
              )
            })}
            <FormFloatingSaveBar
              saving={saving}
              dirtyFieldsRef={dirtyFieldsRef}
              onReset={() => form.reset()}
            />
          </form>
          <TabsContent value="advanced">{advanced}</TabsContent>
        </Tabs>
      </StandaloneKeysContext>
    </FormProvider>
  )
}

/** 局部订阅 dirtyFields，仅在该 Tab 脏状态切换时重渲染圆点 */
function TabDirtyDot({
  tabKey,
  tabOf,
  label,
}: {
  tabKey: string
  tabOf: (key: string) => string | undefined
  label: string
}) {
  const { control } = useFormContext<ConfigValues>()
  const { dirtyFields } = useFormState({ control })
  const dirty = dirtyFields as Record<string, unknown>
  const hasDirty = Object.keys(dirty).some(field => dirty[field] && tabOf(field) === tabKey)
  if (!hasDirty)
    return null
  return <span role="img" aria-label={label} className="size-1.5 rounded-full bg-primary" />
}

function ConditionalVisibleField({
  item,
  showWhen,
}: {
  item: ConfigItem
  showWhen: NonNullable<ConfigItem['showWhen']>
}) {
  const { control } = useFormContext<ConfigValues>()
  const [watched] = useWatch<ConfigValues, [string]>({ control, name: [showWhen.key] })
  if (!showWhen.values.includes(String(watched)))
    return null
  return <ConfigField item={item} />
}

// 组内最前面、不对应配置项的组件（后端 Section.Widget 声明，如主题包预览、发送测试邮件、测试搜索连接）
function SectionWidget({ name, items }: { name?: string, items?: ConfigItem[] }) {
  switch (name) {
    case 'theme_preview':
      return <ThemePackPreviewField />
    case 'email_test':
      return <EmailTestField />
    case 'notification_test':
      return <NotificationTestField />
    case 'search_test':
      return <SearchTestField items={items} />
  }
  return null
}

// 分组卡片右上角的关联管理页快捷入口（如从音乐播放器配置前往歌词特效，从 AI 用户参数前往 AI 用户管理）
function SectionHeaderAction({ name }: { name?: string }) {
  const t = useTranslations('Console.global')
  if (name === 'music_links') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={consolePath.lyricEffect}>
          <AudioLinesIcon className="size-4" />
          {t('manage_lyric_effects')}
          <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
        </Link>
      </Button>
    )
  }
  if (name === 'ai_agents_link') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={consolePath.aiAgent}>
          <BotIcon className="size-4" />
          {t('manage_ai_agents')}
          <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
        </Link>
      </Button>
    )
  }
  return null
}

function Section({
  id,
  title,
  description,
  headerAction,
  children,
}: {
  id?: string
  title: string
  description?: string
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {headerAction}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid items-start gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  )
}
