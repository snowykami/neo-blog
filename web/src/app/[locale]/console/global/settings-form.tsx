'use client'

import type { ConfigValues } from './config-fields'
import type { ConfigItem, ConfigSchema } from '@/models/config'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { useTranslations } from 'next-intl'
import { parseAsString, useQueryState } from 'nuqs'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { getConfigSchema, saveConfig } from '@/api/admin'
import { getSiteInfo } from '@/api/misc'
import { defaultSidebarCards } from '@/components/blog-sidebar/sidebar-cards'
import { ThemePackPreviewField } from '@/components/console/theme-pack-preview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { ConfigField, useConfigT } from './config-fields'
import { EmailTestField } from './email-test-field'
import { NotificationTestField } from './notification-test-field'

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
  // 当前 Tab 写入地址参数，便于直接打开某个分组
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('site').withOptions({ history: 'replace', clearOnDefault: true }))

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

  const onSubmit = async (values: ConfigValues) => {
    const dirty = form.formState.dirtyFields as Record<string, unknown>
    const changes = items.filter(item => dirty[item.key] && !item.envValue).map(item => ({ key: item.key, value: values[item.key] }))
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
      void setTab(target)
  }

  if (!schema)
    return <p className="py-8 text-center text-muted-foreground">{t('loading')}</p>

  const dirtyFields = form.formState.dirtyFields as Record<string, unknown>
  const tabs = [...schema.tabs, { key: 'advanced', title: 'tab_advanced' }]
  return (
    <FormProvider {...form}>
      <StandaloneKeysContext value={standaloneKeys}>
        <Tabs value={tab} onValueChange={value => void setTab(value)} className="gap-4">
          {/* 窄屏时横向滚动 */}
          <TabsList variant="underline" className="w-full justify-start">
            {tabs.map(({ key, title }) => (
              <TabsTrigger key={key} value={key} className="flex-none px-3">
                {tr(title)}
                {Object.keys(dirtyFields).some(field => dirtyFields[field] && tabOf(field) === key) && (
                  <span role="img" aria-label={t('unsaved_changes')} className="size-1.5 rounded-full bg-primary" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* 关闭浏览器原生校验：type=url 会拒绝站内相对链接、小数 step 会拦截已有取值，导致点击保存无反应；输入类型仍保留以适配移动端键盘 */}
          {/* 设置类 Tab 始终挂载、只做隐藏，共用一个表单与保存栏，切换 Tab 不会丢失未保存的修改；高级键值编辑在表单之外 */}
          <form noValidate className={cn('grid gap-4', tab === 'advanced' && 'hidden')} onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
            {schema.tabs.map(({ key }) => (
              <TabsContent key={key} value={key} forceMount className="grid gap-4 data-[state=inactive]:hidden">
                {schema.sections.filter(section => section.tab === key).map(section => (
                  <Section key={section.key} title={tr(section.title) ?? section.key} description={tr(section.description)}>
                    <SectionWidget name={section.widget} />
                    {section.items.map(item => <VisibleField key={item.key} item={item} />)}
                  </Section>
                ))}
              </TabsContent>
            ))}
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
      </StandaloneKeysContext>
    </FormProvider>
  )
}

// 按 showWhen 决定是否显示（如歌单来源为网易云时才显示网易云配置）
function VisibleField({ item }: { item: ConfigItem }) {
  const watched = useWatch<ConfigValues>({ name: item.showWhen?.key ?? item.key })
  if (item.showWhen && !item.showWhen.values.includes(String(watched)))
    return null
  return <ConfigField item={item} />
}

// 组内最前面、不对应配置项的组件（后端 Section.Widget 声明，如主题包预览、发送测试邮件）
function SectionWidget({ name }: { name?: string }) {
  switch (name) {
    case 'theme_preview':
      return <ThemePackPreviewField />
    case 'email_test':
      return <EmailTestField />
    case 'notification_test':
      return <NotificationTestField />
  }
  return null
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
