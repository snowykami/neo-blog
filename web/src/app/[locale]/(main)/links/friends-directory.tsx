'use client'

import type {
  FriendAutoMetaSnapshot,
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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { tabsListVariants, tabsTriggerVariants } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import {
  EMPTY_FRIEND_AUTO_META,
  isPreviewableAvatarUrl,
  isRelatedFriendUrlHost,
  normalizeFriendUrlHost,
  parseFriendTextSnippet,
  pickFriendColorFromSeed,
  resolveAutofillOptionalFields,
} from '@/models/friend'
import { isAdmin } from '@/utils/common/permission'

type CopyFormat = 'text' | 'json' | 'yaml' | 'html'
const COPY_FORMATS: CopyFormat[] = ['text', 'json', 'yaml', 'html']

interface ApplyFormValues {
  groupId: string
  url: string
  name: string
  avatar: string
  description: string
  rssUrl: string
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
  // 水合完成后再读取当前站点 origin，确保 SSR 与首帧客户端渲染完全一致（零 Hydration Mismatch）
  const [clientOrigin, setClientOrigin] = useState('')

  const [myData, setMyData] = useState<MyFriendLinksData | null>(null)
  const [myLoading, setMyLoading] = useState(false)
  const [editingLink, setEditingLink] = useState<FriendLinkMine | null>(null)
  const [autofilling, setAutofilling] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [immediateAvatar, setImmediateAvatar] = useState('')

  const suppressSpyUntilRef = useRef<number>(0)
  const stickyNavRef = useRef<HTMLDivElement | null>(null)
  const groupTabListRef = useRef<HTMLDivElement | null>(null)
  const myLinksReqSeqRef = useRef<number>(0)
  const lastAutoMetaRef = useRef<FriendAutoMetaSnapshot>(EMPTY_FRIEND_AUTO_META)
  const [probeSyncTrigger, setProbeSyncTrigger] = useState(0)

  useEffect(() => {
    setClientOrigin(window.location.origin)
  }, [])

  const groups = publicData.groups
  const allLinks = useMemo(() => groups.flatMap(g => g.links), [groups])

  const resolvedSiteCard = useMemo(() => {
    const rawUrl = publicData.siteInfo.url || runtimeSiteInfo?.baseUrl || clientOrigin
    let baseOrigin = clientOrigin
    if (rawUrl) {
      try {
        baseOrigin = new URL(rawUrl).origin
      }
      catch {
        // 保持 clientOrigin
      }
    }
    const rawAvatar = publicData.siteInfo.avatar || runtimeSiteInfo?.metadata.icon || '/api/site-icon'
    const absoluteAvatar = rawAvatar.startsWith('/') && !rawAvatar.startsWith('//') && baseOrigin
      ? `${baseOrigin}${rawAvatar}`
      : rawAvatar

    return {
      name: publicData.siteInfo.name || runtimeSiteInfo?.metadata.name || 'neo-blog',
      url: rawUrl,
      avatar: rawAvatar,
      snippetAvatar: absoluteAvatar,
      description: publicData.siteInfo.description || runtimeSiteInfo?.metadata.description || '',
    }
  }, [clientOrigin, publicData.siteInfo, runtimeSiteInfo])

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
      rssUrl: '',
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

  // 滚动监听（ScrollSpy）：按首个分组与吸顶导航真实相对位置判定，兼容窄屏长距离平滑滚动、大字号缩放与页底短分组
  useEffect(() => {
    if (groups.length === 0)
      return

    let ticking = false
    const updateActiveFromScroll = () => {
      ticking = false
      if (Date.now() < suppressSpyUntilRef.current)
        return

      const navBottom = stickyNavRef.current?.getBoundingClientRect().bottom ?? 136
      const threshold = navBottom + 36
      const firstEl = document.getElementById(`group-${groups[0].slug}`)
      if (window.scrollY <= 8 || (firstEl && firstEl.getBoundingClientRect().top > threshold)) {
        setActiveGroupTab('all')
        return
      }

      const atPageBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8
      if (atPageBottom) {
        setActiveGroupTab(groups[groups.length - 1].slug)
        return
      }

      let currentSlug = groups[0].slug
      for (const group of groups) {
        const el = document.getElementById(`group-${group.slug}`)
        if (!el)
          continue
        if (el.getBoundingClientRect().top <= threshold)
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

    const onScrollEnd = () => {
      if (suppressSpyUntilRef.current > 0)
        suppressSpyUntilRef.current = 0
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scrollend', onScrollEnd, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scrollend', onScrollEnd)
    }
  }, [groups])

  // 窄屏横向滚动分组栏时，基于 getBoundingClientRect 差值让激活标签保持在水平可视区中央，免疫内边距与 RTL 偏移
  useEffect(() => {
    const listEl = groupTabListRef.current
    if (!listEl || listEl.scrollWidth <= listEl.clientWidth)
      return
    const activeTrigger = listEl.querySelector<HTMLElement>('[data-state="active"]')
    if (!activeTrigger)
      return
    const listRect = listEl.getBoundingClientRect()
    const activeRect = activeTrigger.getBoundingClientRect()
    const currentOffsetInScroll = activeRect.left - listRect.left + listEl.scrollLeft
    const targetLeft = currentOffsetInScroll - (listRect.width - activeRect.width) / 2
    listEl.scrollTo({
      left: Math.max(0, Math.min(targetLeft, listEl.scrollWidth - listEl.clientWidth)),
      behavior: 'smooth',
    })
  }, [activeGroupTab])

  const refreshPublicDirectory = useCallback(async () => {
    try {
      const res = await getPublicFriends()
      setPublicData(res.data)
    }
    catch {
      // 保持已有展示
    }
  }, [])

  const fetchMyLinks = useCallback(async (opts?: { silent?: boolean }) => {
    const seq = ++myLinksReqSeqRef.current
    if (!user) {
      setMyData(null)
      return
    }
    if (!opts?.silent)
      setMyLoading(true)
    try {
      const res = await listMyFriendLinks()
      if (seq !== myLinksReqSeqRef.current)
        return
      setMyData(res.data)
    }
    catch (err) {
      if (seq === myLinksReqSeqRef.current && !opts?.silent)
        toast.error(errorMessageT(err))
    }
    finally {
      if (seq === myLinksReqSeqRef.current)
        setMyLoading(false)
    }
  }, [errorMessageT, user])

  useEffect(() => {
    fetchMyLinks()
  }, [fetchMyLinks])

  // 提交或更新友链后，后台异步执行反链与 RSS 自动探测回填（通常 1~6s 完成），做有界静默二次同步以避免紧接着点编辑时读到旧空值
  useEffect(() => {
    if (probeSyncTrigger === 0 || !user)
      return
    const t1 = window.setTimeout(() => {
      fetchMyLinks({ silent: true })
      refreshPublicDirectory()
    }, 3500)
    const t2 = window.setTimeout(() => {
      fetchMyLinks({ silent: true })
      refreshPublicDirectory()
    }, 8500)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [fetchMyLinks, probeSyncTrigger, refreshPublicDirectory, user])

  const handleGroupTabClick = (value: string) => {
    setActiveGroupTab(value)
    // 平滑滚动期间暂时锁定激活态，scrollend 事件到达时提前解锁，兼容窄屏长距离滚动（1600ms 兜底）
    suppressSpyUntilRef.current = Date.now() + 1600
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
    const targetId = user && (myData?.links.length ?? 0) > 0 ? 'friend-form' : 'friend-apply'
    ;(document.getElementById(targetId) ?? document.getElementById('friend-apply'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToForm = () => {
    ;(document.getElementById('friend-form') ?? document.getElementById('friend-apply'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const snippetText = useMemo(
    () => formatSiteSnippet(copyFormat, {
      name: resolvedSiteCard.name,
      url: resolvedSiteCard.url,
      avatar: resolvedSiteCard.snippetAvatar,
      description: resolvedSiteCard.description,
    }, {
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
      const targetUrl = (data.url || rawUrl).trim()
      if (data.url)
        form.setValue('url', data.url, { shouldValidate: true })
      if (data.name)
        form.setValue('name', data.name, { shouldValidate: true })
      if (data.avatar) {
        setImmediateAvatar(data.avatar.trim())
        form.setValue('avatar', data.avatar, { shouldValidate: true })
      }
      if (data.colorKey)
        form.setValue('colorKey', data.colorKey)

      const { updates, nextMeta } = resolveAutofillOptionalFields({
        targetUrl,
        current: {
          description: form.getValues('description'),
          rssUrl: form.getValues('rssUrl'),
          backlinkUrl: form.getValues('backlinkUrl'),
        },
        incoming: {
          description: data.description,
          rssUrl: data.rssUrl,
          backlinkUrl: data.backlinkUrl,
        },
        prevMeta: lastAutoMetaRef.current,
      })
      if (updates.description !== undefined)
        form.setValue('description', updates.description, { shouldValidate: true })
      if (updates.rssUrl !== undefined)
        form.setValue('rssUrl', updates.rssUrl, { shouldValidate: true })
      if (updates.backlinkUrl !== undefined)
        form.setValue('backlinkUrl', updates.backlinkUrl, { shouldValidate: true })
      lastAutoMetaRef.current = nextMeta

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
    const prevHost = normalizeFriendUrlHost(form.getValues('url')) || lastAutoMetaRef.current.siteHost
    const nextHost = parsed.url ? normalizeFriendUrlHost(parsed.url) : prevHost
    const pasteHostChanged = Boolean(parsed.url && prevHost && nextHost && prevHost !== nextHost)

    if (parsed.url) {
      form.setValue('url', parsed.url, { shouldValidate: true })
      count++
    }
    if (parsed.name) {
      form.setValue('name', parsed.name, { shouldValidate: true })
      count++
    }
    else if (pasteHostChanged) {
      form.setValue('name', '', { shouldValidate: true })
    }

    if (parsed.avatar) {
      setImmediateAvatar(parsed.avatar.trim())
      form.setValue('avatar', parsed.avatar, { shouldValidate: true })
      count++
    }
    else if (pasteHostChanged) {
      setImmediateAvatar('')
      form.setValue('avatar', '', { shouldValidate: true })
    }

    if (parsed.description) {
      form.setValue('description', parsed.description, { shouldValidate: true })
      count++
    }
    else if (pasteHostChanged) {
      form.setValue('description', '', { shouldValidate: true })
    }

    const targetUrl = parsed.url || form.getValues('url').trim()
    const currentRss = form.getValues('rssUrl').trim()
    if (parsed.rssUrl) {
      form.setValue('rssUrl', parsed.rssUrl, { shouldValidate: true })
      count++
    }
    else if (
      pasteHostChanged
      || (parsed.url && currentRss && !isRelatedFriendUrlHost(currentRss, targetUrl, { allowExternalFeedHosts: false }))
    ) {
      form.setValue('rssUrl', '', { shouldValidate: true })
    }

    const currentBacklink = form.getValues('backlinkUrl').trim()
    if (parsed.backlinkUrl) {
      form.setValue('backlinkUrl', parsed.backlinkUrl, { shouldValidate: true })
      count++
    }
    else if (
      pasteHostChanged
      || (parsed.url && currentBacklink && !isRelatedFriendUrlHost(currentBacklink, targetUrl))
    ) {
      form.setValue('backlinkUrl', '', { shouldValidate: true })
    }

    if (parsed.name || parsed.url) {
      form.setValue('colorKey', pickFriendColorFromSeed(`${parsed.name || ''}${parsed.url || ''}`))
    }
    if (count > 0) {
      lastAutoMetaRef.current = {
        source: 'paste',
        siteHost: nextHost,
        description: form.getValues('description').trim(),
        rssUrl: form.getValues('rssUrl').trim(),
        backlinkUrl: form.getValues('backlinkUrl').trim(),
      }
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
    setImmediateAvatar(item.avatar.trim())
    lastAutoMetaRef.current = {
      source: 'seed',
      siteHost: normalizeFriendUrlHost(item.url),
      description: (item.description || '').trim(),
      rssUrl: (item.rssUrl || '').trim(),
      backlinkUrl: (item.backlinkUrl || '').trim(),
    }
    form.reset({
      groupId: String(item.groupId),
      url: item.url,
      name: item.name,
      avatar: item.avatar,
      description: item.description,
      rssUrl: item.rssUrl || '',
      backlinkUrl: item.backlinkUrl || '',
      colorKey: item.colorKey || 'sky',
    })
    scrollToForm()
  }

  const cancelEditLink = () => {
    setEditingLink(null)
    setImmediateAvatar('')
    lastAutoMetaRef.current = EMPTY_FRIEND_AUTO_META
    form.reset({
      groupId: defaultGroupId,
      url: '',
      name: '',
      avatar: '',
      description: '',
      rssUrl: '',
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
      rssUrl: values.rssUrl.trim(),
      backlinkUrl: values.backlinkUrl.trim(),
      colorKey: values.colorKey,
    }
    const willRunAsyncDiscovery = !editingLink
      || editingLink.url !== payload.url
      || payload.rssUrl === ''
      || payload.backlinkUrl === ''
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
      if (willRunAsyncDiscovery)
        setProbeSyncTrigger(n => n + 1)
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
  const debouncedPreviewAvatar = useDebouncedValue(watchedValues.avatar, 300)
  const rawWatchedAvatar = watchedValues.avatar.trim()
  const effectiveRawAvatar = !rawWatchedAvatar
    ? ''
    : (rawWatchedAvatar === editingLink?.avatar || rawWatchedAvatar === immediateAvatar)
        ? rawWatchedAvatar
        : debouncedPreviewAvatar.trim()
  const previewAvatar = isPreviewableAvatarUrl(effectiveRawAvatar) ? effectiveRawAvatar : ''
  const previewAvatarUrl = previewAvatar && editingLink && previewAvatar === editingLink.avatar
    ? editingLink.avatarUrl
    : undefined
  const userIsAdmin = Boolean(user && isAdmin({ user }))
  const myLinks = myData?.links ?? []
  const quotaReached = !userIsAdmin && !editingLink && myData !== null && myLinks.length >= myData.quotaLimit

  return (
    <div id="friends-top" className="grid min-w-0 grid-cols-[minmax(0,1fr)] scroll-mt-24 gap-4">
      {/* 顶部标题与快捷操作 */}
      <div className="surface-card flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 sm:gap-4 sm:p-5 md:p-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
          <h1 className="text-xl font-bold tracking-tight wrap-anywhere md:text-2xl">{t('title')}</h1>
          <p className="text-sm wrap-anywhere text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
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

      {/* 吸顶分组锚点导航：使用语义化 nav + 按钮（复用 Tabs underline 视觉变体，无悬空 aria-controls 且方向键不误滚屏） */}
      {groups.length > 0 && (
        <nav
          ref={stickyNavRef}
          aria-label={t('title')}
          className="surface-card sticky top-[calc(var(--nav-h)+0.75rem)] z-20 min-w-0 overflow-hidden rounded-2xl bg-card/95 px-2.5 pt-1 backdrop-blur-md md:top-[calc(var(--nav-h)+1rem)] md:px-4"
        >
          <div
            ref={groupTabListRef}
            className={cn(tabsListVariants({ variant: 'underline' }), 'relative w-full max-w-full min-w-0 justify-start border-b-0')}
          >
            <button
              type="button"
              data-state={activeGroupTab === 'all' ? 'active' : 'inactive'}
              aria-current={activeGroupTab === 'all' ? 'true' : undefined}
              onClick={() => handleGroupTabClick('all')}
              className={cn(tabsTriggerVariants({ variant: 'underline' }), 'flex-none px-3')}
            >
              <LayoutGridIcon className="size-4" />
              <span>{t('group_all')}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{allLinks.length}</span>
            </button>
            {groups.map(group => (
              <button
                key={group.id}
                type="button"
                data-state={activeGroupTab === group.slug ? 'active' : 'inactive'}
                aria-current={activeGroupTab === group.slug ? 'true' : undefined}
                onClick={() => handleGroupTabClick(group.slug)}
                className={cn(tabsTriggerVariants({ variant: 'underline' }), 'flex-none px-3')}
              >
                <GroupPresetIcon presetKey={group.presetKey} />
                <span>{presetT.groupName(group.presetKey, group.name)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{group.links.length}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* 全部分组按顶栏左右顺序在单页内依次纵向展开 */}
      {groups.length === 0
        ? (
            <div className="surface-card min-w-0 rounded-2xl bg-card p-6 sm:p-8">
              <Empty>
                <EmptyDescription>{t('empty_directory')}</EmptyDescription>
              </Empty>
            </div>
          )
        : (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
              {groups.map((group) => {
                const localizedName = presetT.groupName(group.presetKey, group.name)
                const localizedDesc = presetT.groupDescription(group.presetKey, group.description)
                return (
                  <section
                    key={group.id}
                    id={`group-${group.slug}`}
                    className="surface-card grid min-w-0 grid-cols-[minmax(0,1fr)] scroll-mt-[calc(var(--nav-h)+4.75rem)] gap-3.5 rounded-2xl bg-card p-4 sm:gap-4 sm:p-5 md:scroll-mt-[calc(var(--nav-h)+5rem)] md:p-6"
                  >
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
                      <SectionTitle as="h2" className="flex flex-wrap items-baseline gap-2 text-lg wrap-anywhere">
                        <span>{localizedName}</span>
                        <span className="text-sm font-normal text-muted-foreground tabular-nums">
                          {group.links.length}
                        </span>
                      </SectionTitle>
                      {localizedDesc && (
                        <p className="pl-4 text-xs wrap-anywhere text-muted-foreground">{localizedDesc}</p>
                      )}
                    </div>

                    {group.links.length === 0
                      ? (
                          <p className="py-4 text-center text-sm text-muted-foreground">{t('empty_group')}</p>
                        )
                      : (
                          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      <section id="friend-apply" className="surface-card grid min-w-0 grid-cols-[minmax(0,1fr)] scroll-mt-[calc(var(--nav-h)+4.75rem)] gap-4 rounded-2xl bg-card p-4 sm:p-5 md:scroll-mt-[calc(var(--nav-h)+5rem)] md:p-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <SectionTitle as="h2" className="text-lg wrap-anywhere">{t('site_card_title')}</SectionTitle>
            <p className="pl-4 text-xs wrap-anywhere text-muted-foreground">{t('site_card_desc')}</p>
          </div>
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t('site_card_title')}
              className={cn(tabsListVariants({ variant: 'outline' }), 'max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}
            >
              {COPY_FORMATS.map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  data-state={copyFormat === fmt ? 'active' : 'inactive'}
                  aria-pressed={copyFormat === fmt}
                  onClick={() => setCopyFormat(fmt)}
                  className={cn(tabsTriggerVariants({ variant: 'outline' }), 'flex-none px-2.5 text-xs uppercase')}
                >
                  {fmt}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleCopySnippet}>
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              {t('copy_button')}
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-center">
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
          <pre className="max-w-full min-w-0 overflow-x-auto rounded-xl border bg-muted/40 p-3.5 font-mono text-xs leading-relaxed text-foreground/90">
            {snippetText}
          </pre>
        </div>
      </section>

      {/* 自助申请与管理我的友链 */}
      <section className="surface-card grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-2xl bg-card p-4 sm:gap-5 sm:p-5 md:p-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <SectionTitle as="h2" className="text-lg wrap-anywhere">{t('apply_title')}</SectionTitle>
            <p className="pl-4 text-xs wrap-anywhere text-muted-foreground">{t('apply_desc')}</p>
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
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
                {/* 我已提交的友链列表：窄屏上下分行防状态徽章挤压重叠按钮，驳回说明支持多行完整阅读 */}
                {myLoading && !myData
                  ? (
                      <div className="grid min-w-0 gap-2">
                        <Skeleton className="h-14 w-full rounded-xl" />
                      </div>
                    )
                  : myLinks.length > 0 && (
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
                      <h3 className="text-sm font-medium">{t('my_links_title')}</h3>
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                        {myLinks.map(item => (
                          <div
                            key={item.id}
                            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 rounded-xl border bg-muted/25 px-3 py-2.5 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-3.5"
                          >
                            <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                              <ImageAvatar
                                src={item.avatarUrl || item.avatar || undefined}
                                fallbackSrc={item.avatarUrl && item.avatarUrl !== item.avatar ? item.avatar : undefined}
                                alt=""
                                fallback={(item.name || '?').slice(0, 1).toUpperCase()}
                                sizes="36px"
                                fallbackDelayMs={150}
                                className="mt-0.5 size-9 shrink-0 sm:mt-0"
                              />
                              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="max-w-full truncate text-sm font-medium hover:underline"
                                  >
                                    {item.name}
                                  </a>
                                  {renderStatusBadge(item.status)}
                                </div>
                                {item.reviewNote
                                  ? (
                                      <p className="line-clamp-3 text-xs leading-relaxed wrap-anywhere text-muted-foreground">
                                        {item.reviewNote}
                                      </p>
                                    )
                                  : (
                                      <p className="truncate text-xs text-muted-foreground">
                                        {item.url}
                                      </p>
                                    )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/50 pt-1.5 sm:border-t-0 sm:pt-0">
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
                <div
                  id="friend-form"
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)] scroll-mt-[calc(var(--nav-h)+4.75rem)] gap-4 rounded-xl border bg-muted/15 p-3.5 sm:p-4 md:scroll-mt-[calc(var(--nav-h)+5rem)] md:p-5"
                >
                  <Collapsible open={pasteOpen} onOpenChange={setPasteOpen} className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
                        <h3 className="text-sm font-semibold wrap-anywhere">
                          {editingLink
                            ? t('form_edit_title', { name: editingLink.name })
                            : t('form_create_title')}
                        </h3>
                        {editingLink && !userIsAdmin && (
                          <p className="text-xs wrap-anywhere text-amber-600 dark:text-amber-400">
                            {t('edit_re_review_notice')}
                          </p>
                        )}
                      </div>

                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          <ClipboardPasteIcon className="size-3.5" />
                          {t('paste_parse_toggle')}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="mt-3 min-w-0">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border bg-card p-3">
                        <Textarea
                          rows={3}
                          value={pasteText}
                          onChange={e => setPasteText(e.target.value)}
                          placeholder={t('paste_parse_placeholder')}
                          className="field-sizing-fixed max-h-44 min-w-0 overflow-y-auto font-mono text-xs break-all"
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

                  <Form {...form}>
                    <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" onSubmit={form.handleSubmit(onSubmitApply)}>
                      <FormField
                        control={form.control}
                        name="url"
                        rules={{
                          validate: v => v.trim() !== '' || t('field_url_required'),
                        }}
                        render={({ field }) => (
                          <FormItem className="grid min-w-0 gap-2">
                            <FormLabel>{t('field_url')}</FormLabel>
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                              <FormControl>
                                <Input
                                  {...field}
                                  type="text"
                                  inputMode="url"
                                  maxLength={512}
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

                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="name"
                          rules={{
                            validate: v => v.trim() !== '' || t('field_name_required'),
                          }}
                          render={({ field }) => (
                            <FormItem className="grid min-w-0 gap-2">
                              <FormLabel>{t('field_name')}</FormLabel>
                              <FormControl>
                                <Input {...field} maxLength={64} placeholder={t('field_name_placeholder')} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="groupId"
                          render={({ field }) => (
                            <FormItem className="grid min-w-0 gap-2">
                              <FormLabel>{t('field_group')}</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-full min-w-0">
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

                      <FormField
                        control={form.control}
                        name="avatar"
                        rules={{
                          validate: v => v.trim() !== '' || t('field_avatar_required'),
                        }}
                        render={({ field }) => (
                          <FormItem className="grid min-w-0 gap-2">
                            <FormLabel>{t('field_avatar')}</FormLabel>
                            <FormControl>
                              <Input {...field} type="text" inputMode="url" maxLength={512} placeholder="https://example.com/avatar.png" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="rssUrl"
                          render={({ field }) => (
                            <FormItem className="grid min-w-0 gap-2">
                              <FormLabel className="leading-snug">{t('field_rss_url')}</FormLabel>
                              <FormControl>
                                <Input {...field} type="text" inputMode="url" maxLength={512} placeholder={t('field_rss_placeholder')} />
                              </FormControl>
                              <FormDescription className="text-xs leading-normal">
                                {t('auto_detect_if_blank')}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="backlinkUrl"
                          render={({ field }) => (
                            <FormItem className="grid min-w-0 gap-2">
                              <FormLabel className="leading-snug">{t('field_backlink_url')}</FormLabel>
                              <FormControl>
                                <Input {...field} type="text" inputMode="url" maxLength={512} placeholder={t('field_backlink_placeholder')} />
                              </FormControl>
                              <FormDescription className="text-xs leading-normal">
                                {t('auto_detect_if_blank')}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="grid min-w-0 gap-2">
                            <FormLabel>{t('field_description')}</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                rows={2}
                                maxLength={200}
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
                          <FormItem className="grid min-w-0 gap-2">
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

                      {/* 实时卡片效果预览（对输入中的头像 URL 防抖门控，避免按键中途触发无效图片请求） */}
                      <div className="grid min-w-0 gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('live_preview')}</span>
                        <div className="max-w-sm min-w-0">
                          <FriendCard
                            interactive={false}
                            item={{
                              name: watchedValues.name,
                              url: watchedValues.url || 'https://example.com',
                              avatar: previewAvatar,
                              avatarUrl: previewAvatarUrl,
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
