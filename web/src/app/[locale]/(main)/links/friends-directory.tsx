'use client'

import type {
  FriendColorKey,
  FriendGroupPresetKey,
  FriendLinkMine,
  FriendStatus,
  MyFriendLinksData,
  PublicFriendsData,
} from '@/models/friend'
import {
  AwardIcon,
  CheckIcon,
  ClipboardPasteIcon,
  CodeXmlIcon,
  CopyIcon,
  CpuIcon,
  GlobeIcon,
  LayoutGridIcon,
  Link2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ShuffleIcon,
  SparklesIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import {
  autofillFriendLink,
  createMyFriendLink,
  deleteMyFriendLink,
  getPublicFriends,
  listMyFriendLinks,
  updateMyFriendLink,
} from '@/api/friend'
import { GuestLoginInvite } from '@/components/auth/guest-login-invite'
import { ImageAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FriendCard, useFriendPresetTranslator } from '@/components/friends/friend-card'
import { FriendColorPicker } from '@/components/friends/friend-color-picker'
import { SectionTitle } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'
import { pickFriendColorFromSeed } from '@/models/friend'
import { isAdmin } from '@/utils/common/permission'

type CopyFormat = 'text' | 'json' | 'yaml' | 'html'

interface ApplyFormValues {
  groupId: string
  url: string
  name: string
  avatar: string
  description: string
  backlinkUrl: string
  colorKey: FriendColorKey
}

function GroupPresetIcon({ presetKey }: { presetKey: FriendGroupPresetKey }) {
  switch (presetKey) {
    case 'friends':
      return <UsersIcon className="size-4" />
    case 'seniors':
      return <AwardIcon className="size-4" />
    case 'official':
      return <GlobeIcon className="size-4" />
    case 'projects':
      return <CodeXmlIcon className="size-4" />
    case 'tech':
      return <CpuIcon className="size-4" />
    default:
      return <Link2Icon className="size-4" />
  }
}

function parseFriendTextSnippet(raw: string): Partial<Record<'name' | 'url' | 'avatar' | 'description', string>> {
  const trimmed = raw.trim()
  if (!trimmed)
    return {}

  // 优先尝试 JSON 解析
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          if (typeof obj[k] === 'string' && obj[k].trim())
            return (obj[k] as string).trim()
        }
        return undefined
      }
      return {
        name: pick('name', 'title', 'site', 'sitename'),
        url: pick('url', 'link', 'href', 'site_url'),
        avatar: pick('avatar', 'icon', 'logo', 'img', 'image'),
        description: pick('description', 'desc', 'descr', 'bio', 'slogan'),
      }
    }
    catch {
      // 回退逐行解析
    }
  }

  const out: Partial<Record<'name' | 'url' | 'avatar' | 'description', string>> = {}
  const lines = trimmed.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*•\s]+/, '').trim()
    const sepIdx = line.search(/[:：=]/)
    if (sepIdx <= 0)
      continue
    const key = line.slice(0, sepIdx).trim().toLowerCase()
    const val = line.slice(sepIdx + 1).trim().replace(/^['"`]+|['"`,]+$/g, '')
    if (!val)
      continue
    if (/name|title|名称|名字|站名|站点|标题/.test(key) && !out.name)
      out.name = val
    else if (/avatar|icon|logo|img|头像|图标/.test(key) && !out.avatar)
      out.avatar = val
    else if (/url|link|href|地址|链接|网址/.test(key) && !out.url)
      out.url = val
    else if (/desc|bio|slogan|描述|简介|签名|介绍/.test(key) && !out.description)
      out.description = val
  }
  return out
}

function formatSiteSnippet(format: CopyFormat, card: { name: string, url: string, avatar: string, description: string }, labels: {
  name: string
  url: string
  avatar: string
  desc: string
}): string {
  switch (format) {
    case 'json':
      return JSON.stringify(card, null, 2)
    case 'yaml':
      return [
        `- name: ${JSON.stringify(card.name)}`,
        `  link: ${JSON.stringify(card.url)}`,
        `  avatar: ${JSON.stringify(card.avatar)}`,
        `  descr: ${JSON.stringify(card.description)}`,
      ].join('\n')
    case 'html':
      return `<a href="${card.url}" target="_blank" rel="noopener noreferrer" title="${card.description.replace(/"/g, '&quot;')}">${card.name}</a>`
    default:
      return [
        `${labels.name}: ${card.name}`,
        `${labels.url}: ${card.url}`,
        `${labels.avatar}: ${card.avatar}`,
        `${labels.desc}: ${card.description}`,
      ].join('\n')
  }
}

export function FriendsDirectory({ initialData }: { initialData: PublicFriendsData }) {
  const t = useTranslations('Friends')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const presetT = useFriendPresetTranslator()
  const { user } = useAuth()
  const { siteInfo: runtimeSiteInfo } = useSiteInfo()

  const [publicData, setPublicData] = useState<PublicFriendsData>(initialData)
  const [activeGroupTab, setActiveGroupTab] = useState<string>('all')
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('text')
  const [copied, setCopied] = useState(false)

  const [myData, setMyData] = useState<MyFriendLinksData | null>(null)
  const [myLoading, setMyLoading] = useState(false)
  const [editingLink, setEditingLink] = useState<FriendLinkMine | null>(null)
  const [autofilling, setAutofilling] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const suppressSpyUntilRef = useRef<number>(0)
  const stickyNavRef = useRef<HTMLDivElement | null>(null)

  const groups = publicData.groups
  const allLinks = useMemo(() => groups.flatMap(g => g.links), [groups])

  const resolvedSiteCard = useMemo(() => {
    const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    return {
      name: publicData.siteInfo.name || runtimeSiteInfo?.metadata.name || 'neo-blog',
      url: publicData.siteInfo.url || runtimeSiteInfo?.baseUrl || fallbackOrigin,
      avatar: publicData.siteInfo.avatar || runtimeSiteInfo?.metadata.icon || `${fallbackOrigin}/api/site-icon`,
      description: publicData.siteInfo.description || runtimeSiteInfo?.metadata.description || '',
    }
  }, [publicData.siteInfo, runtimeSiteInfo])

  const defaultGroupId = useMemo(
    () => (groups[0]?.id ? String(groups[0].id) : '1'),
    [groups],
  )

  const form = useForm<ApplyFormValues>({
    defaultValues: {
      groupId: defaultGroupId,
      url: '',
      name: '',
      avatar: '',
      description: '',
      backlinkUrl: '',
      colorKey: 'sky',
    },
  })

  // 当分组首次加载且表单尚未选择有效分组时同步默认分组
  useEffect(() => {
    const current = form.getValues('groupId')
    if (!current || !groups.some(g => String(g.id) === current)) {
      if (groups[0]?.id)
        form.setValue('groupId', String(groups[0].id))
    }
  }, [form, groups])

  // 滚动监听（ScrollSpy）：单页上下排列所有分组，随滚动同步顶部分组 Tab 高亮
  useEffect(() => {
    if (groups.length === 0)
      return

    let ticking = false
    const updateActiveFromScroll = () => {
      ticking = false
      if (Date.now() < suppressSpyUntilRef.current)
        return
      if (window.scrollY < 120) {
        setActiveGroupTab('all')
        return
      }
      const navBottom = stickyNavRef.current?.getBoundingClientRect().bottom ?? 136
      const threshold = navBottom + 28
      let currentSlug = 'all'
      for (const group of groups) {
        const el = document.getElementById(`group-${group.slug}`)
        if (!el)
          continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= threshold)
          currentSlug = group.slug
      }
      setActiveGroupTab(currentSlug)
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        window.requestAnimationFrame(updateActiveFromScroll)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [groups])

  const refreshPublicDirectory = useCallback(async () => {
    try {
      const res = await getPublicFriends()
      setPublicData(res.data)
    }
    catch {
      // 保持已有展示
    }
  }, [])

  const fetchMyLinks = useCallback(async () => {
    if (!user) {
      setMyData(null)
      return
    }
    setMyLoading(true)
    try {
      const res = await listMyFriendLinks()
      setMyData(res.data)
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setMyLoading(false)
    }
  }, [errorMessageT, user])

  useEffect(() => {
    fetchMyLinks()
  }, [fetchMyLinks])

  const handleGroupTabClick = (value: string) => {
    setActiveGroupTab(value)
    suppressSpyUntilRef.current = Date.now() + 650
    if (value === 'all') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const section = document.getElementById(`group-${value}`)
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleRandomVisit = () => {
    if (allLinks.length === 0)
      return
    const healthyPool = allLinks.filter(item => item.healthStatus !== 'unreachable')
    const pool = healthyPool.length > 0 ? healthyPool : allLinks
    const picked = pool[Math.floor(Math.random() * pool.length)]
    if (picked?.url)
      window.open(picked.url, '_blank', 'noopener,noreferrer')
  }

  const scrollToApply = () => {
    document.getElementById('friend-apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const snippetText = useMemo(
    () => formatSiteSnippet(copyFormat, resolvedSiteCard, {
      name: t('field_name'),
      url: t('field_url'),
      avatar: t('field_avatar'),
      desc: t('field_description'),
    }),
    [copyFormat, resolvedSiteCard, t],
  )

  const handleCopySnippet = async () => {
    if (await copyToClipboard(snippetText)) {
      setCopied(true)
      toast.success(t('copied_site_info'))
      window.setTimeout(setCopied, 1800, false)
    }
  }

  const handleAutofill = async () => {
    const rawUrl = form.getValues('url').trim()
    if (!rawUrl) {
      toast.error(t('url_required_for_autofill'))
      return
    }
    setAutofilling(true)
    try {
      const res = await autofillFriendLink(rawUrl)
      const data = res.data
      if (data.url)
        form.setValue('url', data.url, { shouldValidate: true })
      if (data.name)
        form.setValue('name', data.name, { shouldValidate: true })
      if (data.avatar)
        form.setValue('avatar', data.avatar, { shouldValidate: true })
      if (data.description)
        form.setValue('description', data.description, { shouldValidate: true })
      if (data.colorKey)
        form.setValue('colorKey', data.colorKey)
      setMyData(prev => prev ? { ...prev, autofillRemaining: data.autofillRemaining } : prev)
      toast.success(t('autofill_success'))
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setAutofilling(false)
    }
  }

  const handleApplyPaste = () => {
    const parsed = parseFriendTextSnippet(pasteText)
    let count = 0
    if (parsed.url) {
      form.setValue('url', parsed.url, { shouldValidate: true })
      count++
    }
    if (parsed.name) {
      form.setValue('name', parsed.name, { shouldValidate: true })
      count++
    }
    if (parsed.avatar) {
      form.setValue('avatar', parsed.avatar, { shouldValidate: true })
      count++
    }
    if (parsed.description) {
      form.setValue('description', parsed.description, { shouldValidate: true })
      count++
    }
    if (parsed.name || parsed.url) {
      form.setValue('colorKey', pickFriendColorFromSeed(`${parsed.name || ''}${parsed.url || ''}`))
    }
    if (count > 0) {
      toast.success(t('paste_parse_success'))
      setPasteText('')
      setPasteOpen(false)
    }
    else {
      toast.error(t('paste_parse_empty'))
    }
  }

  const startEditLink = (item: FriendLinkMine) => {
    setEditingLink(item)
    form.reset({
      groupId: String(item.groupId),
      url: item.url,
      name: item.name,
      avatar: item.avatar,
      description: item.description,
      backlinkUrl: item.backlinkUrl || '',
      colorKey: item.colorKey || 'sky',
    })
    scrollToApply()
  }

  const cancelEditLink = () => {
    setEditingLink(null)
    form.reset({
      groupId: defaultGroupId,
      url: '',
      name: '',
      avatar: '',
      description: '',
      backlinkUrl: '',
      colorKey: 'sky',
    })
  }

  const onSubmitApply = async (values: ApplyFormValues) => {
    const payload = {
      groupId: Number(values.groupId) || 0,
      name: values.name.trim(),
      url: values.url.trim(),
      avatar: values.avatar.trim(),
      description: values.description.trim(),
      backlinkUrl: values.backlinkUrl.trim(),
      colorKey: values.colorKey,
    }
    try {
      if (editingLink) {
        await updateMyFriendLink(editingLink.id, payload)
        toast.success(t('update_submitted'))
      }
      else {
        await createMyFriendLink(payload)
        toast.success(t('create_submitted'))
      }
      cancelEditLink()
      await Promise.all([fetchMyLinks(), refreshPublicDirectory()])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleDeleteMyLink = async (id: number) => {
    await deleteMyFriendLink(id)
    if (editingLink?.id === id)
      cancelEditLink()
    toast.success(operationT('delete_success'))
    await Promise.all([fetchMyLinks(), refreshPublicDirectory()])
  }

  const renderStatusBadge = (status: FriendStatus) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600">{t('status_approved')}</Badge>
      case 'pre_approved':
        return <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">{t('status_pre_approved')}</Badge>
      case 'rejected':
        return <Badge variant="destructive">{t('status_rejected')}</Badge>
      default:
        return <Badge variant="outline">{t('status_pending')}</Badge>
    }
  }

  const watchedValues = form.watch()
  const userIsAdmin = Boolean(user && isAdmin({ user }))
  const myLinks = myData?.links ?? []
  const quotaReached = !userIsAdmin && !editingLink && myData !== null && myLinks.length >= myData.quotaLimit

  return (
    <div id="friends-top" className="grid scroll-mt-24 gap-4">
      {/* 顶部标题与快捷操作 */}
      <div className="surface-card flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-card p-5 md:p-6">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {allLinks.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={handleRandomVisit}>
              <ShuffleIcon className="size-4" />
              {t('random_visit')}
            </Button>
          )}
          <Button type="button" size="sm" onClick={scrollToApply}>
            <PlusIcon className="size-4" />
            {t('apply_or_manage')}
          </Button>
        </div>
      </div>

      {/* 吸顶分组导航：与右侧栏保持一致的 top-[calc(var(--nav-h)+1rem)] 呼吸间距，不与顶栏贴死或重叠 */}
      {groups.length > 0 && (
        <div
          ref={stickyNavRef}
          className="surface-card sticky top-[calc(var(--nav-h)+1rem)] z-20 rounded-2xl bg-card/92 px-4 pt-1 backdrop-blur-md"
        >
          <Tabs value={activeGroupTab} onValueChange={handleGroupTabClick}>
            <TabsList variant="underline" className="w-full justify-start border-b-0">
              <TabsTrigger value="all" className="flex-none px-3">
                <LayoutGridIcon className="size-4" />
                <span>{t('group_all')}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{allLinks.length}</span>
              </TabsTrigger>
              {groups.map(group => (
                <TabsTrigger key={group.id} value={group.slug} className="flex-none px-3">
                  <GroupPresetIcon presetKey={group.presetKey} />
                  <span>{presetT.groupName(group.presetKey, group.name)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{group.links.length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* 全部分组按顶栏左右顺序在单页内依次纵向展开 */}
      {groups.length === 0
        ? (
            <div className="surface-card rounded-2xl bg-card p-8">
              <Empty>
                <EmptyDescription>{t('empty_directory')}</EmptyDescription>
              </Empty>
            </div>
          )
        : (
            <div className="grid gap-4">
              {groups.map((group) => {
                const localizedName = presetT.groupName(group.presetKey, group.name)
                const localizedDesc = presetT.groupDescription(group.presetKey, group.description)
                return (
                  <section
                    key={group.id}
                    id={`group-${group.slug}`}
                    className="surface-card grid scroll-mt-[calc(var(--nav-h)+5rem)] gap-4 rounded-2xl bg-card p-5 md:p-6"
                  >
                    <div className="grid gap-1">
                      <SectionTitle as="h2" className="text-lg">
                        <span>{localizedName}</span>
                        <span className="text-sm font-normal text-muted-foreground tabular-nums">
                          {group.links.length}
                        </span>
                      </SectionTitle>
                      {localizedDesc && (
                        <p className="pl-3.5 text-xs text-muted-foreground">{localizedDesc}</p>
                      )}
                    </div>

                    {group.links.length === 0
                      ? (
                          <p className="py-4 text-center text-sm text-muted-foreground">{t('empty_group')}</p>
                        )
                      : (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {group.links.map(link => (
                              <FriendCard key={link.id} item={link} />
                            ))}
                          </div>
                        )}
                  </section>
                )
              })}
            </div>
          )}

      {/* 本站友链名片（支持一键复制多格式） */}
      <section id="friend-apply" className="surface-card grid scroll-mt-[calc(var(--nav-h)+5rem)] gap-4 rounded-2xl bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <SectionTitle as="h2" className="text-lg">{t('site_card_title')}</SectionTitle>
            <p className="pl-3.5 text-xs text-muted-foreground">{t('site_card_desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={copyFormat} onValueChange={v => setCopyFormat(v as CopyFormat)}>
              <TabsList variant="outline">
                <TabsTrigger value="text" className="px-2.5 text-xs">TEXT</TabsTrigger>
                <TabsTrigger value="json" className="px-2.5 text-xs">JSON</TabsTrigger>
                <TabsTrigger value="yaml" className="px-2.5 text-xs">YAML</TabsTrigger>
                <TabsTrigger value="html" className="px-2.5 text-xs">HTML</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button type="button" variant="outline" size="sm" onClick={handleCopySnippet}>
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              {t('copy_button')}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,280px)_1fr] md:items-center">
          <FriendCard
            interactive={false}
            item={{
              name: resolvedSiteCard.name,
              url: resolvedSiteCard.url,
              avatar: resolvedSiteCard.avatar,
              description: resolvedSiteCard.description,
              colorKey: 'sky',
              healthStatus: 'healthy',
              latencyMs: 120,
            }}
          />
          <pre className="overflow-x-auto rounded-xl border bg-muted/40 p-3.5 font-mono text-xs leading-relaxed text-foreground/90">
            {snippetText}
          </pre>
        </div>
      </section>

      {/* 自助申请与管理我的友链 */}
      <section className="surface-card grid gap-5 rounded-2xl bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <SectionTitle as="h2" className="text-lg">{t('apply_title')}</SectionTitle>
            <p className="pl-3.5 text-xs text-muted-foreground">{t('apply_desc')}</p>
          </div>
          {user && myData && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">
                {userIsAdmin
                  ? t('quota_unlimited')
                  : t('quota_used', { used: myLinks.length, limit: myData.quotaLimit })}
              </Badge>
              {!userIsAdmin && (
                <span className="text-muted-foreground">
                  {t('ai_review_hint', { remaining: myData.aiReviewRemaining, limit: myData.aiReviewLimit })}
                </span>
              )}
            </div>
          )}
        </div>

        {!user
          ? (
              <GuestLoginInvite
                title={t('guest_title')}
                description={t('guest_desc')}
                reason="friend_link"
              />
            )
          : (
              <div className="grid gap-6">
                {/* 我已提交的友链列表 */}
                {myLoading && !myData
                  ? (
                      <div className="grid gap-2">
                        <Skeleton className="h-14 w-full rounded-xl" />
                      </div>
                    )
                  : myLinks.length > 0 && (
                    <div className="grid gap-2.5">
                      <h3 className="text-sm font-medium">{t('my_links_title')}</h3>
                      <div className="grid gap-2">
                        {myLinks.map(item => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/25 px-3.5 py-2.5"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <ImageAvatar
                                src={item.avatar || undefined}
                                alt=""
                                fallback={(item.name || '?').slice(0, 1).toUpperCase()}
                                sizes="36px"
                                className="size-9 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="truncate text-sm font-medium hover:underline"
                                  >
                                    {item.name}
                                  </a>
                                  {renderStatusBadge(item.status)}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                  {item.reviewNote || item.url}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => startEditLink(item)}
                              >
                                <PencilIcon className="size-3.5" />
                                {operationT('edit')}
                              </Button>
                              <ConfirmDialog
                                title={t('delete_my_link_title', { name: item.name })}
                                description={t('delete_my_link_desc')}
                                confirmLabel={operationT('delete')}
                                onConfirm={() => handleDeleteMyLink(item.id)}
                              >
                                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                  <Trash2Icon className="size-3.5" />
                                  {operationT('delete')}
                                </Button>
                              </ConfirmDialog>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* 提交新友链 / 修改已有友链表单 */}
                <div className="grid gap-4 rounded-xl border bg-muted/15 p-4 md:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="grid gap-0.5">
                      <h3 className="text-sm font-semibold">
                        {editingLink
                          ? t('form_edit_title', { name: editingLink.name })
                          : t('form_create_title')}
                      </h3>
                      {editingLink && !userIsAdmin && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {t('edit_re_review_notice')}
                        </p>
                      )}
                    </div>

                    <Collapsible open={pasteOpen} onOpenChange={setPasteOpen}>
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          <ClipboardPasteIcon className="size-3.5" />
                          {t('paste_parse_toggle')}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-3 w-full">
                        <div className="grid gap-2 rounded-lg border bg-card p-3">
                          <Textarea
                            rows={3}
                            value={pasteText}
                            onChange={e => setPasteText(e.target.value)}
                            placeholder={t('paste_parse_placeholder')}
                            className="font-mono text-xs"
                          />
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
                              {operationT('cancel')}
                            </Button>
                            <Button type="button" size="sm" onClick={handleApplyPaste}>
                              {t('paste_parse_apply')}
                            </Button>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>

                  <Form {...form}>
                    <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmitApply)}>
                      <FormField
                        control={form.control}
                        name="url"
                        rules={{
                          validate: v => v.trim() !== '' || t('field_url_required'),
                        }}
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{t('field_url')}</FormLabel>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <FormControl>
                                <Input
                                  {...field}
                                  type="url"
                                  placeholder="https://example.com"
                                  autoComplete="off"
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={autofilling || (myData !== null && !userIsAdmin && myData.autofillRemaining <= 0)}
                                onClick={handleAutofill}
                                className="shrink-0"
                              >
                                {autofilling
                                  ? <Loader2Icon className="size-4 animate-spin" />
                                  : <SparklesIcon className="size-4" />}
                                {myData && !userIsAdmin
                                  ? t('autofill_button_quota', { remaining: myData.autofillRemaining })
                                  : t('autofill_button')}
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="name"
                          rules={{
                            validate: v => v.trim() !== '' || t('field_name_required'),
                          }}
                          render={({ field }) => (
                            <FormItem className="grid gap-2">
                              <FormLabel>{t('field_name')}</FormLabel>
                              <FormControl>
                                <Input {...field} maxLength={80} placeholder={t('field_name_placeholder')} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="groupId"
                          render={({ field }) => (
                            <FormItem className="grid gap-2">
                              <FormLabel>{t('field_group')}</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {groups.map(group => (
                                    <SelectItem key={group.id} value={String(group.id)}>
                                      {presetT.groupName(group.presetKey, group.name)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="avatar"
                          rules={{
                            validate: v => v.trim() !== '' || t('field_avatar_required'),
                          }}
                          render={({ field }) => (
                            <FormItem className="grid gap-2">
                              <FormLabel>{t('field_avatar')}</FormLabel>
                              <FormControl>
                                <Input {...field} type="url" placeholder="https://example.com/avatar.png" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="backlinkUrl"
                          render={({ field }) => (
                            <FormItem className="grid gap-2">
                              <FormLabel>{t('field_backlink_url')}</FormLabel>
                              <FormControl>
                                <Input {...field} type="url" placeholder="https://example.com/links" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{t('field_description')}</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                rows={2}
                                maxLength={240}
                                placeholder={t('field_description_placeholder')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="colorKey"
                        render={({ field }) => (
                          <FormItem className="grid gap-2">
                            <FormLabel>{t('field_color')}</FormLabel>
                            <FormControl>
                              <FriendColorPicker
                                value={field.value}
                                seedText={`${watchedValues.name}${watchedValues.url}`}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* 实时卡片效果预览（跟随页面当前亮/暗主题切换） */}
                      <div className="grid gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('live_preview')}</span>
                        <div className="max-w-sm">
                          <FriendCard
                            interactive={false}
                            item={{
                              name: watchedValues.name,
                              url: watchedValues.url || 'https://example.com',
                              avatar: watchedValues.avatar,
                              description: watchedValues.description,
                              colorKey: watchedValues.colorKey,
                              healthStatus: 'healthy',
                              latencyMs: 180,
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                        {editingLink && (
                          <Button type="button" variant="outline" onClick={cancelEditLink}>
                            {operationT('cancel')}
                          </Button>
                        )}
                        <Button
                          type="submit"
                          disabled={form.formState.isSubmitting || quotaReached}
                        >
                          {form.formState.isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
                          {quotaReached
                            ? t('quota_reached_button')
                            : editingLink
                              ? t('submit_update')
                              : t('submit_apply')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              </div>
            )}
      </section>
    </div>
  )
}
