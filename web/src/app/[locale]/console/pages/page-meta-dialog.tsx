'use client'

import type { SubmitHandler } from 'react-hook-form'
import type { PageHtmlSizeMode, PageKind, PageLayout, PageModel } from '@/models/page'
import { HandshakeIcon, MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createPage, updatePage } from '@/api/page'
import { AssetField } from '@/components/common/asset-picker'
import { LabelWithInfo } from '@/components/common/info-tooltip'
import { PageIconPicker } from '@/components/common/page-icon-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useErrorMessageT, useOperationT, useResponseErrorDetailsT } from '@/hooks/use-translations'
import { useRouter } from '@/i18n/navigation'
import { PAGE_HTML_SIZE_MODES, PAGE_KINDS, PAGE_LAYOUTS } from '@/models/page'
import { isAdmin } from '@/utils/common/permission'
import { getPageEditUrl, mainPath } from '@/utils/common/route'

interface PageMetaForm {
  title: string
  slug: string
  cover: string
  description: string
  isPrivate: boolean
  showInNav: boolean
  icon: string
  layout: PageLayout
  kind: PageKind
  linkUrl: string
  fullscreen: boolean
  htmlSizeMode: PageHtmlSizeMode
  htmlAspectRatio: string
  htmlHeight: number
}

/** 链接页面的地址：站内路径（以单个 / 开头）或 http(s) 绝对地址，与后端校验一致 */
export function isValidPageLink(value: string): boolean {
  const link = value.trim()
  if (!link || /[\s\\]/.test(link))
    return false
  if (link.startsWith('/'))
    return !link.startsWith('//')
  try {
    const url = new URL(link)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.host
  }
  catch {
    return false
  }
}

/** HTML 页面的固定宽高比：宽:高（或 宽/高），均为 1~1000 的整数，与后端校验一致 */
export function isValidAspectRatio(value: string): boolean {
  const match = /^\s*(\d{1,4})\s*[:/]\s*(\d{1,4})\s*$/.exec(value)
  return !!match && [match[1], match[2]].every(n => Number(n) >= 1 && Number(n) <= 1000)
}

export function PageMetaDialog({
  onOpenChange,
  onPageChange,
  open,
  page,
}: {
  onOpenChange: (open: boolean) => void
  onPageChange: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  open: boolean
  page: PageModel | null
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const errorDetailsT = useResponseErrorDetailsT()
  const t = useTranslations('Console.pages.meta')
  const routeT = useTranslations('Route')
  const editorT = useTranslations('Console.editor')
  const router = useRouter()
  const { user } = useAuth()
  const form = useForm<PageMetaForm>({
    defaultValues: toFormValues(page),
  })
  const kind = form.watch('kind')
  const linkUrl = form.watch('linkUrl')
  const isLink = kind === 'link'
  const isHtml = kind === 'html'
  const htmlSizeMode = form.watch('htmlSizeMode')
  const showInNav = form.watch('showInNav')
  // HTML 页面可运行任意脚本，只有管理员可以创建或修改（后端同样校验）
  const kinds = PAGE_KINDS.filter(item => item !== 'html' || (user && isAdmin({ user })))

  // 每次打开对话框时用最新的 page 重置表单，避免列表中切换可见性后表单仍是旧值
  // 仅在由关闭变为打开时重置，打开期间 page 变化不覆盖用户正在编辑的内容
  const latestRef = useRef(page)
  latestRef.current = page
  useEffect(() => {
    if (open)
      form.reset(toFormValues(latestRef.current))
  }, [open, form])

  const applyBuiltInPreset = (preset: 'friends' | 'music') => {
    if (preset === 'friends') {
      form.setValue('kind', 'link')
      if (!form.getValues('title').trim())
        form.setValue('title', routeT('friends'), { shouldValidate: true })
      form.setValue('linkUrl', mainPath.friends, { shouldValidate: true })
      form.setValue('icon', 'handshake')
      form.setValue('showInNav', true)
    }
    else {
      form.setValue('kind', 'link')
      if (!form.getValues('title').trim())
        form.setValue('title', routeT('music'), { shouldValidate: true })
      form.setValue('linkUrl', '/music', { shouldValidate: true })
      form.setValue('icon', 'music')
      form.setValue('showInNav', true)
    }
  }

  const onSubmit: SubmitHandler<PageMetaForm> = async (formData) => {
    const data = { ...formData, htmlHeight: Number(formData.htmlHeight) || 0 }
    if (page) {
      await updatePage({
        page: {
          id: page.id,
          ...data,
        },
      })
        .then(() => {
          toast.success(operationT('update_success'))
          onPageChange({ page: { id: page.id, ...data } })
          onOpenChange(false)
        })
        .catch((error) => {
          toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`)
        })
      return
    }

    const isLink = data.kind === 'link'
    // 新建页面初始正文留空，不再预填标题 h1；链接页面创建后不进入编辑器，slug 留空由后端生成
    const content = ''
    await createPage({
      page: {
        ...data,
        slug: isLink ? '' : data.slug,
        content,
        type: 'html',
      },
    })
      .then((res) => {
        toast.success(operationT('create_success'))
        onPageChange({
          page: {
            id: res.data.id,
            ...data,
            content,
            type: 'html',
          },
        })
        form.reset()
        onOpenChange(false)
        // 正文页面创建后直接进入编辑器继续撰写，HTML 页面进入上传页
        if (!isLink)
          router.push(getPageEditUrl({ id: res.data.id, kind: data.kind }))
      })
      .catch((error) => {
        toast.error(`${operationT('create_failed')}: ${errorMessageT(error)}`)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{page ? t('edit_page') : t('create_page')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="title"
              rules={{ validate: value => !!value.trim() || t('title_and_slug_required') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('title')}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <LabelWithInfo info={t('kind_hint')}><FormLabel>{t('kind')}</FormLabel></LabelWithInfo>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kinds.map(item => (
                          <SelectItem key={item} value={item}>{t(`kind_${item}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <LabelWithInfo info={t('icon_hint')}><FormLabel>{t('icon')}</FormLabel></LabelWithInfo>
                    <FormControl>
                      <PageIconPicker value={field.value} kind={kind} linkUrl={linkUrl} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* 链接页面通过导航跳转到它的地址，没有自己的访问路径：不需要 slug（新建时由后端生成内部 slug） */}
            {!isLink && (
              <FormField
                control={form.control}
                name="slug"
                rules={{
                  validate: (value) => {
                    if (form.getValues('kind') === 'link')
                      return true
                    if (!value.trim())
                      return t('title_and_slug_required')
                    return !isNumericSlug(value) || errorDetailsT('slug_cannot_be_numeric')
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('slug')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {isLink && (
              <FormField
                control={form.control}
                name="linkUrl"
                rules={{ validate: value => isValidPageLink(value) || t('link_invalid') }}
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <LabelWithInfo info={t('link_hint')}><FormLabel>{t('link_url')}</FormLabel></LabelWithInfo>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => applyBuiltInPreset('friends')}
                        >
                          <HandshakeIcon className="size-3" />
                          {routeT('friends')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => applyBuiltInPreset('music')}
                        >
                          <MusicIcon className="size-3" />
                          {routeT('music')}
                        </Button>
                      </div>
                    </div>
                    <FormControl><Input {...field} placeholder="/links" autoComplete="off" spellCheck={false} className="font-mono text-[13.5px]" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {!isLink && (
              <>
                <FormField
                  control={form.control}
                  name="cover"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('cover')}</FormLabel>
                      <FormControl>
                        <AssetField {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('description')}</FormLabel>
                      <FormControl><Textarea {...field} /></FormControl>
                    </FormItem>
                  )}
                />
                {/* HTML 页面没有正文版式，改为设置 iframe 的显示尺寸 */}
                {!isHtml && (
                  <FormField
                    control={form.control}
                    name="layout"
                    render={({ field }) => (
                      <FormItem>
                        <LabelWithInfo info={editorT('layout_hint')}><FormLabel>{editorT('layout')}</FormLabel></LabelWithInfo>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PAGE_LAYOUTS.map(layout => (
                              <SelectItem key={layout} value={layout}>{editorT(`layout_${layout}`)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                )}
                {isHtml && (
                  <div className="flex gap-3">
                    <FormField
                      control={form.control}
                      name="htmlSizeMode"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <LabelWithInfo info={t('html_size_mode_hint')}><FormLabel>{t('html_size_mode')}</FormLabel></LabelWithInfo>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {PAGE_HTML_SIZE_MODES.map(mode => (
                                <SelectItem key={mode} value={mode}>{t(`html_size_${mode}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    {htmlSizeMode === 'ratio' && (
                      <FormField
                        control={form.control}
                        name="htmlAspectRatio"
                        rules={{ validate: value => form.getValues('kind') !== 'html' || form.getValues('htmlSizeMode') !== 'ratio' || isValidAspectRatio(value) || t('html_aspect_ratio_invalid') }}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel>{t('html_aspect_ratio')}</FormLabel>
                            <FormControl><Input {...field} placeholder="16:9" autoComplete="off" className="font-mono text-[13.5px]" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {htmlSizeMode === 'height' && (
                      <FormField
                        control={form.control}
                        name="htmlHeight"
                        rules={{
                          validate: (value) => {
                            if (form.getValues('kind') !== 'html' || form.getValues('htmlSizeMode') !== 'height')
                              return true
                            const height = Number(value)
                            return (height >= 100 && height <= 10000) || t('html_height_invalid')
                          },
                        }}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel>{t('html_height')}</FormLabel>
                            <FormControl><Input type="number" min={100} max={10000} {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="fullscreen"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <LabelWithInfo info={editorT('fullscreen_hint')}><FormLabel>{editorT('fullscreen')}</FormLabel></LabelWithInfo>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )}
                />
              </>
            )}
            <div className="grid gap-3">
              <FormField
                control={form.control}
                name="showInNav"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="grid gap-0.5">
                      <LabelWithInfo info={editorT('show_in_nav_hint')}><FormLabel>{t('show_in_nav')}</FormLabel></LabelWithInfo>
                      {showInNav && (
                        <span className="text-xs text-muted-foreground">{t('nav_order_drag_hint')}</span>
                      )}
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <LabelWithInfo info={editorT('private_hint')}><FormLabel>{t('private')}</FormLabel></LabelWithInfo>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset(toFormValues(page))
                    onOpenChange(false)
                  }}
                >
                  {operationT('cancel')}
                </Button>
                {/* 通过表单 submit 提交，成功后再关闭对话框 */}
                <Button type="submit" disabled={form.formState.isSubmitting}>{page ? operationT('update') : operationT('create')}</Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// 切换到固定宽高比 / 固定高度时的初始值
const DEFAULT_HTML_ASPECT_RATIO = '16:9'
const DEFAULT_HTML_HEIGHT = 600

function toFormValues(page: PageModel | null): PageMetaForm {
  return page
    ? {
        title: page.title,
        slug: page.slug,
        cover: page.cover || '',
        description: page.description || '',
        isPrivate: page.isPrivate,
        showInNav: page.showInNav,
        icon: page.icon || '',
        layout: page.layout === 'wide' ? 'wide' : 'reading',
        kind: PAGE_KINDS.includes(page.kind) ? page.kind : 'content',
        linkUrl: page.linkUrl || '',
        fullscreen: !!page.fullscreen,
        htmlSizeMode: PAGE_HTML_SIZE_MODES.includes(page.htmlSizeMode) ? page.htmlSizeMode : 'fill',
        htmlAspectRatio: page.htmlAspectRatio || DEFAULT_HTML_ASPECT_RATIO,
        htmlHeight: page.htmlHeight || DEFAULT_HTML_HEIGHT,
      }
    : {
        title: '',
        slug: '',
        cover: '',
        description: '',
        isPrivate: false,
        showInNav: false,
        icon: '',
        layout: 'reading',
        kind: 'content',
        linkUrl: '',
        fullscreen: false,
        htmlSizeMode: 'fill',
        htmlAspectRatio: DEFAULT_HTML_ASPECT_RATIO,
        htmlHeight: DEFAULT_HTML_HEIGHT,
      }
}

// 后端不允许纯数字 slug（会与 id 访问冲突）
function isNumericSlug(value: string) {
  return /^\d+$/.test(value.trim())
}
