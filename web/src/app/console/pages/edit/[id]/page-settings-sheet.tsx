'use client'

import type { ContentMeta } from '@/hooks/use-content-editor'
import type { PageLayout } from '@/models/page'
import { CompassIcon, FileTextIcon, LayoutTemplateIcon, SendIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { InfoTooltip, LabelWithInfo } from '@/components/common/info-tooltip'
import {
  ContentSettingsSheet,
  CoverField,
  NumberField,
  SettingsSection,
  SwitchField,
  useSyncSettingsForm,
} from '@/components/console/editor/content-settings-sheet'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useResponseErrorDetailsT } from '@/hooks/use-translations'
import { PAGE_LAYOUTS } from '@/models/page'

interface PageSettingsValues {
  slug: string
  description: string
  cover: string
  isPrivate: boolean
  showInNav: boolean
  navOrder: number
  layout: PageLayout
}

function toValues(meta: ContentMeta): PageSettingsValues {
  return {
    slug: meta.slug,
    description: meta.description,
    cover: meta.cover,
    isPrivate: meta.isPrivate,
    showInNav: meta.showInNav,
    navOrder: meta.navOrder,
    layout: meta.layout,
  }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}

/**
 * 页面设置抽屉：访问路径（必填）、摘要（与画布同步）、封面、私密、导航展示与排序、前台版式
 */
export function PageSettingsSheet({
  open,
  onOpenChange,
  meta,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: ContentMeta
  onChange: (patch: Partial<ContentMeta>) => void
}) {
  const t = useTranslations('Console.editor')
  const pageT = useTranslations('Console.pages.meta')
  const errorDetailsT = useResponseErrorDetailsT()
  const form = useForm<PageSettingsValues>({ mode: 'onChange', defaultValues: toValues(meta) })
  useSyncSettingsForm(form, open, toValues(meta), onChange)

  return (
    <ContentSettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings_page')}>
      <Form {...form}>
        <form className="grid gap-4" onSubmit={e => e.preventDefault()}>
          <SettingsSection icon={FileTextIcon} title={t('settings_basic')}>
            <FormField
              control={form.control}
              name="slug"
              rules={{
                validate: (value) => {
                  if (!value.trim())
                    return pageT('title_and_slug_required')
                  return !isNumericSlug(value) || errorDetailsT('slug_cannot_be_numeric')
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <LabelWithInfo info={t('slug_hint_page')}><FormLabel>{pageT('slug')}</FormLabel></LabelWithInfo>
                  <FormControl>
                    <Input {...field} autoComplete="off" spellCheck={false} className="font-mono text-[13.5px]" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <div className="flex w-full items-center gap-1">
                    <FormLabel>{pageT('description')}</FormLabel>
                    <InfoTooltip content={t('description_sync_hint')} />
                    <span className="ml-auto font-normal text-muted-foreground/70 tabular-nums">{field.value.length}</span>
                  </div>
                  <FormControl>
                    <Textarea {...field} rows={3} placeholder={t('description_sheet_placeholder')} />
                  </FormControl>
                </FormItem>
              )}
            />
            <CoverField form={form} name="cover" label={pageT('cover')} />
          </SettingsSection>

          <SettingsSection icon={CompassIcon} title={t('settings_nav')}>
            <SwitchField form={form} name="showInNav" label={pageT('show_in_nav')} description={t('show_in_nav_hint')} />
            <NumberField form={form} name="navOrder" label={pageT('nav_order')} description={t('nav_order_hint')} />
          </SettingsSection>

          <SettingsSection icon={LayoutTemplateIcon} title={t('settings_layout')}>
            <FormField
              control={form.control}
              name="layout"
              render={({ field }) => (
                <FormItem>
                  <LabelWithInfo info={t('layout_hint')}><FormLabel>{t('layout')}</FormLabel></LabelWithInfo>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAGE_LAYOUTS.map(layout => (
                        <SelectItem key={layout} value={layout}>{t(`layout_${layout}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </SettingsSection>

          <SettingsSection icon={SendIcon} title={t('settings_publish')}>
            <SwitchField form={form} name="isPrivate" label={pageT('private')} description={t('private_hint')} />
          </SettingsSection>
        </form>
      </Form>
    </ContentSettingsSheet>
  )
}
