'use client'

import type {
  FriendAutoMetaSnapshot,
  FriendBacklinkStatus,
  FriendColorKey,
  FriendGroupAdmin,
  FriendGroupPresetKey,
  FriendGroupSortItem,
  FriendHealthStatus,
  FriendLinkAdmin,
  FriendSortMode,
  FriendStatus,
} from '@/models/friend'
import type { User } from '@/models/user'
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  FolderPlusIcon,
  ListOrderedIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RadioIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundCheckIcon,
  XCircleIcon,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { listUsers } from '@/api/admin'
import {
  adminCreateFriendGroup,
  adminCreateFriendLink,
  adminDeleteFriendGroup,
  adminDeleteFriendLink,
  adminGetFriendSettings,
  adminGetFriendSortOverview,
  adminListFriendGroups,
  adminListFriendLinks,
  adminProbeAllFriendLinks,
  adminProbeFriendLink,
  adminReorderFriendGroups,
  adminReorderFriendLinks,
  adminReviewFriendLink,
  adminTransferFriendLink,
  adminUpdateFriendGroup,
  adminUpdateFriendLink,
  adminUpdateFriendSettings,
  adminUpdateFriendSortMode,
  autofillFriendLink,
} from '@/api/friend'
import { ImageAvatar, UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationController } from '@/components/common/pagination'
import { SortableDragHandle, SortableList } from '@/components/common/sortable-list'
import { STICKY_ACTIONS_CLASS } from '@/components/console/common/sticky-actions'
import { FriendCard, useFriendPresetTranslator } from '@/components/friends/friend-card'
import { FriendColorPicker } from '@/components/friends/friend-color-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useDebouncedState, useDebouncedValue } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import {
  EMPTY_FRIEND_AUTO_META,
  FRIEND_GROUP_PRESETS,
  FRIEND_STATUSES,
  isPreviewableAvatarUrl,
  normalizeFriendUrlHost,
  resolveAutofillOptionalFields,
  resolveFriendPalette,
  splitFriendBacklinkAliasesInput,
} from '@/models/friend'
import { isAdmin } from '@/utils/common/permission'

const PAGE_SIZE = 20

interface AdminLinkFormValues {
  groupId: string
  url: string
  name: string
  avatar: string
  description: string
  rssUrl: string
  backlinkUrl: string
  colorKey: FriendColorKey
  status: FriendStatus
  reviewNote: string
}

interface AdminGroupFormValues {
  presetKey: FriendGroupPresetKey
  name: string
  slug: string
  description: string
  isPublic: boolean
  skipBacklinkCheck: boolean
}

interface RejectFormValues {
  reviewNote: string
}

interface AdminSettingsFormValues {
  allowRedirects: boolean
  maxRedirects: string
  allowNonStandardPorts: boolean
  aliasHostsText: string
}

type MainTabKey = 'links' | 'sort' | 'groups' | 'settings'

function extractExactHostname(raw?: string | null): string {
  const trimmed = raw?.trim() ?? ''
  if (!/^https?:\/\//i.test(trimmed))
    return ''
  try {
    const parsed = new URL(trimmed)
    return parsed.hostname.toLowerCase().replace(/\.$/, '')
  }
  catch {
    return ''
  }
}

export function FriendManage() {
  const t = useTranslations('Console.friends')
  const friendT = useTranslations('Friends')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const format = useFormatter()
  const presetT = useFriendPresetTranslator()
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()

  const [mainTab, setMainTab] = useState<MainTabKey>('links')
  const [groups, setGroups] = useState<FriendGroupAdmin[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)

  const [links, setLinks] = useState<FriendLinkAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [linksLoading, setLinksLoading] = useState(true)

  // 友链默认排序策略与分组内拖拽排序状态
  const [sortMode, setSortMode] = useState<FriendSortMode>('manual')
  const [savingSortMode, setSavingSortMode] = useState(false)
  const [sortGroups, setSortGroups] = useState<FriendGroupSortItem[]>([])
  const [sortLoading, setSortLoading] = useState(true)
  const [activeSortGroupId, setActiveSortGroupId] = useState<number | null>(null)
  const [reorderingLinks, setReorderingLinks] = useState(false)

  // 友链全局设置（重定向、非标端口与反链别名域名）状态
  const [aliasHosts, setAliasHosts] = useState<string[]>([])
  const [savedProbePolicy, setSavedProbePolicy] = useState({
    allowRedirects: true,
    maxRedirects: 5,
    allowNonStandardPorts: true,
  })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  const groupReqSeqRef = useRef(0)
  const linksReqSeqRef = useRef(0)
  const sortReqSeqRef = useRef(0)
  const settingsReqSeqRef = useRef(0)
  const settingsInFlightRef = useRef(false)
  const sortGroupTabListRef = useRef<HTMLDivElement | null>(null)
  const dialogAutoMetaRef = useRef<FriendAutoMetaSnapshot>(EMPTY_FRIEND_AUTO_META)
  const [probeSyncTrigger, setProbeSyncTrigger] = useState(0)

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [keyword, setKeyword, debouncedKeyword] = useDebouncedState('', 300)
  const [page, setPage] = useState(1)

  const [probingAll, setProbingAll] = useState(false)
  const [probingId, setProbingId] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)

  // 友链新建/编辑弹窗
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [editingLink, setEditingLink] = useState<FriendLinkAdmin | null>(null)
  const [autofilling, setAutofilling] = useState(false)
  const [immediateDialogAvatar, setImmediateDialogAvatar] = useState('')

  // 驳回说明弹窗
  const [rejectTarget, setRejectTarget] = useState<FriendLinkAdmin | null>(null)

  // 转移归属用户弹窗
  const [transferTarget, setTransferTarget] = useState<FriendLinkAdmin | null>(null)
  const [userKeyword, setUserKeyword, debouncedUserKeyword] = useDebouncedState('', 250)
  const [candidateUsers, setCandidateUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [transferring, setTransferring] = useState(false)

  // 删除确认弹窗（从下拉菜单触发，使用受控模式）
  const [deleteLinkTarget, setDeleteLinkTarget] = useState<FriendLinkAdmin | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<FriendGroupAdmin | null>(null)

  // 分组新建/编辑弹窗
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<FriendGroupAdmin | null>(null)

  const userIsAdmin = Boolean(user && isAdmin({ user }))

  const groupMap = useMemo(() => {
    const map = new Map<number, FriendGroupAdmin>()
    for (const g of groups)
      map.set(g.id, g)
    return map
  }, [groups])

  const fetchGroups = useCallback(async (opts?: { silent?: boolean, suppressErrorToast?: boolean }) => {
    if (!userIsAdmin)
      return
    const seq = ++groupReqSeqRef.current
    if (!opts?.silent)
      setGroupsLoading(true)
    try {
      const res = await adminListFriendGroups()
      if (seq !== groupReqSeqRef.current)
        return
      setGroups(res.data.groups || [])
    }
    catch (err) {
      if (seq === groupReqSeqRef.current && !opts?.suppressErrorToast)
        toast.error(errorMessageT(err))
    }
    finally {
      if (seq === groupReqSeqRef.current)
        setGroupsLoading(false)
    }
  }, [errorMessageT, userIsAdmin])

  const fetchLinks = useCallback(async (opts?: { silent?: boolean, suppressErrorToast?: boolean }) => {
    if (!userIsAdmin)
      return
    const seq = ++linksReqSeqRef.current
    if (!opts?.silent)
      setLinksLoading(true)
    try {
      const res = await adminListFriendLinks({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
        groupId: groupFilter === 'all' ? undefined : Number(groupFilter),
        keyword: debouncedKeyword.trim() || undefined,
      })
      if (seq !== linksReqSeqRef.current)
        return
      setLinks(res.data.links || [])
      setTotal(res.data.total || 0)
      setPendingReviewCount(res.data.pendingReviewCount || 0)
    }
    catch (err) {
      if (seq === linksReqSeqRef.current && !opts?.suppressErrorToast)
        toast.error(errorMessageT(err))
    }
    finally {
      if (seq === linksReqSeqRef.current)
        setLinksLoading(false)
    }
  }, [debouncedKeyword, errorMessageT, groupFilter, page, statusFilter, userIsAdmin])

  const fetchSortOverview = useCallback(async (opts?: { silent?: boolean, suppressErrorToast?: boolean }) => {
    if (!userIsAdmin)
      return
    const seq = ++sortReqSeqRef.current
    if (!opts?.silent)
      setSortLoading(true)
    try {
      const res = await adminGetFriendSortOverview()
      if (seq !== sortReqSeqRef.current)
        return
      const nextGroups = res.data.groups || []
      setSortMode(res.data.sortMode || 'manual')
      setSortGroups(nextGroups)
      setActiveSortGroupId((prev) => {
        if (prev !== null && nextGroups.some(item => item.group.id === prev))
          return prev
        return nextGroups[0]?.group.id ?? null
      })
    }
    catch (err) {
      if (seq === sortReqSeqRef.current && !opts?.suppressErrorToast)
        toast.error(errorMessageT(err))
    }
    finally {
      if (seq === sortReqSeqRef.current)
        setSortLoading(false)
    }
  }, [errorMessageT, userIsAdmin])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  useEffect(() => {
    fetchSortOverview()
  }, [fetchSortOverview])

  // 窄屏切换友链排序分组标签或首次异步加载挂载分组栏时，自动将激活项滚动到水平可视区中央（遵循减弱动态效果偏好）
  useEffect(() => {
    if (mainTab !== 'sort' || sortGroups.length === 0)
      return
    const listEl = sortGroupTabListRef.current
    if (!listEl || listEl.scrollWidth <= listEl.clientWidth)
      return
    const activeTrigger = listEl.querySelector<HTMLElement>('[data-state="active"]')
    if (!activeTrigger)
      return
    const listRect = listEl.getBoundingClientRect()
    const activeRect = activeTrigger.getBoundingClientRect()
    const currentOffsetInScroll = activeRect.left - listRect.left + listEl.scrollLeft
    const targetLeft = currentOffsetInScroll - (listRect.width - activeRect.width) / 2
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    listEl.scrollTo({
      left: Math.max(0, Math.min(targetLeft, listEl.scrollWidth - listEl.clientWidth)),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [activeSortGroupId, mainTab, sortGroups.length])

  // 新建/更新留空字段或触发全量拨测后，后台异步执行反链与 RSS 自动发现回填，做有界静默二次同步防止编辑时读到旧快照
  useEffect(() => {
    if (probeSyncTrigger === 0 || !userIsAdmin)
      return
    const t1 = window.setTimeout(() => {
      fetchLinks({ silent: true, suppressErrorToast: true })
      fetchSortOverview({ silent: true, suppressErrorToast: true })
    }, 3500)
    const t2 = window.setTimeout(() => {
      fetchLinks({ silent: true, suppressErrorToast: true })
      fetchSortOverview({ silent: true, suppressErrorToast: true })
    }, 8500)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [fetchLinks, fetchSortOverview, probeSyncTrigger, userIsAdmin])

  useEffect(() => {
    if (!transferTarget || !userIsAdmin)
      return
    let cancelled = false
    setUsersLoading(true)
    listUsers({
      page: 1,
      size: 8,
      keyword: debouncedUserKeyword.trim() || undefined,
      status: 'active',
    })
      .then((res) => {
        if (!cancelled)
          setCandidateUsers((res.data.users || []).filter(u => !u.isAi))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled)
          setUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedUserKeyword, transferTarget, userIsAdmin])

  const handleTransferOwner = async (targetUserId: number) => {
    if (!transferTarget || transferring)
      return
    setTransferring(true)
    try {
      const res = await adminTransferFriendLink(transferTarget.id, targetUserId)
      linksReqSeqRef.current += 1
      sortReqSeqRef.current += 1
      setLinks(prev => prev.map(item => (item.id === transferTarget.id ? res.data : item)))
      setSortGroups(prev => prev.map(g => ({
        ...g,
        links: g.links.map(item => (item.id === transferTarget.id ? res.data : item)),
      })))
      toast.success(t('transfer_success'))
      setTransferTarget(null)
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setTransferring(false)
    }
  }

  const linkForm = useForm<AdminLinkFormValues>({
    defaultValues: {
      groupId: '',
      url: '',
      name: '',
      avatar: '',
      description: '',
      rssUrl: '',
      backlinkUrl: '',
      colorKey: 'sky',
      status: 'approved',
      reviewNote: '',
    },
  })

  const groupForm = useForm<AdminGroupFormValues>({
    defaultValues: {
      presetKey: 'custom',
      name: '',
      slug: '',
      description: '',
      isPublic: true,
      skipBacklinkCheck: false,
    },
  })

  const rejectForm = useForm<RejectFormValues>({
    defaultValues: { reviewNote: '' },
  })

  const settingsForm = useForm<AdminSettingsFormValues>({
    defaultValues: {
      allowRedirects: true,
      maxRedirects: '5',
      allowNonStandardPorts: true,
      aliasHostsText: '',
    },
  })
  const watchedAllowRedirects = settingsForm.watch('allowRedirects')
  const isSettingsDirty = settingsForm.formState.isDirty
  const isSettingsDirtyRef = useRef(false)
  isSettingsDirtyRef.current = isSettingsDirty

  const fetchSettings = useCallback(async (opts?: { silent?: boolean, suppressErrorToast?: boolean }) => {
    if (!userIsAdmin)
      return
    const seq = ++settingsReqSeqRef.current
    settingsInFlightRef.current = true
    if (!opts?.silent) {
      setSettingsLoading(true)
      setSettingsLoadError(false)
    }
    try {
      const res = await adminGetFriendSettings()
      if (seq !== settingsReqSeqRef.current)
        return
      const nextAliases = res.data.backlinkAliasHosts || []
      const nextAllowRedirects = res.data.allowRedirects ?? true
      const nextMaxRedirects = res.data.maxRedirects >= 1 && res.data.maxRedirects <= 10 ? res.data.maxRedirects : 5
      const nextAllowNonStandardPorts = res.data.allowNonStandardPorts ?? true
      setAliasHosts(nextAliases)
      setSavedProbePolicy({
        allowRedirects: nextAllowRedirects,
        maxRedirects: nextMaxRedirects,
        allowNonStandardPorts: nextAllowNonStandardPorts,
      })
      setSettingsLoaded(true)
      setSettingsLoadError(false)
      if (!isSettingsDirtyRef.current) {
        settingsForm.reset({
          allowRedirects: nextAllowRedirects,
          maxRedirects: String(nextMaxRedirects),
          allowNonStandardPorts: nextAllowNonStandardPorts,
          aliasHostsText: nextAliases.join('\n'),
        })
      }
    }
    catch (err) {
      if (seq === settingsReqSeqRef.current) {
        setSettingsLoadError(true)
        if (!opts?.suppressErrorToast)
          toast.error(errorMessageT(err))
      }
    }
    finally {
      if (seq === settingsReqSeqRef.current) {
        settingsInFlightRef.current = false
        setSettingsLoading(false)
      }
    }
  }, [errorMessageT, settingsForm, userIsAdmin])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const onSubmitSettings = async (values: AdminSettingsFormValues) => {
    if (savingSettings || !settingsLoaded)
      return
    const rawMax = values.maxRedirects.trim()
    let parsedMax = savedProbePolicy.maxRedirects
    if (values.allowRedirects) {
      if (!/^\d+$/.test(rawMax)) {
        settingsForm.setError('maxRedirects', { message: t('settings_max_redirects_invalid') })
        return
      }
      const num = Number.parseInt(rawMax, 10)
      if (!Number.isInteger(num) || num < 1 || num > 10) {
        settingsForm.setError('maxRedirects', { message: t('settings_max_redirects_invalid') })
        return
      }
      parsedMax = num
    }
    else if (/^\d+$/.test(rawMax)) {
      const num = Number.parseInt(rawMax, 10)
      if (Number.isInteger(num) && num >= 1 && num <= 10)
        parsedMax = num
    }
    setSavingSettings(true)
    settingsReqSeqRef.current += 1
    settingsInFlightRef.current = false
    setSettingsLoading(false)
    try {
      const payloadHosts = splitFriendBacklinkAliasesInput(values.aliasHostsText)
      const res = await adminUpdateFriendSettings({
        backlinkAliasHosts: payloadHosts,
        allowRedirects: values.allowRedirects,
        maxRedirects: parsedMax,
        allowNonStandardPorts: values.allowNonStandardPorts,
      })
      settingsReqSeqRef.current += 1
      const savedAliases = res.data.backlinkAliasHosts || []
      const nextAllowRedirects = res.data.allowRedirects ?? values.allowRedirects
      const nextMaxRedirects = res.data.maxRedirects >= 1 && res.data.maxRedirects <= 10 ? res.data.maxRedirects : parsedMax
      const nextAllowNonStandardPorts = res.data.allowNonStandardPorts ?? values.allowNonStandardPorts
      const aliasesChanged = savedAliases.length !== aliasHosts.length
        || savedAliases.some((item, idx) => item !== aliasHosts[idx])
      const policyChanged = nextAllowRedirects !== savedProbePolicy.allowRedirects
        || nextMaxRedirects !== savedProbePolicy.maxRedirects
        || nextAllowNonStandardPorts !== savedProbePolicy.allowNonStandardPorts
      setAliasHosts(savedAliases)
      setSavedProbePolicy({
        allowRedirects: nextAllowRedirects,
        maxRedirects: nextMaxRedirects,
        allowNonStandardPorts: nextAllowNonStandardPorts,
      })
      setSettingsLoaded(true)
      setSettingsLoadError(false)
      settingsForm.reset({
        allowRedirects: nextAllowRedirects,
        maxRedirects: String(nextMaxRedirects),
        allowNonStandardPorts: nextAllowNonStandardPorts,
        aliasHostsText: savedAliases.join('\n'),
      })
      if (aliasesChanged || policyChanged)
        setProbeSyncTrigger(n => n + 1)
      toast.success(t('backlink_alias_saved'))
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setSavingSettings(false)
    }
  }

  const openCreateLinkDialog = () => {
    setEditingLink(null)
    setImmediateDialogAvatar('')
    dialogAutoMetaRef.current = EMPTY_FRIEND_AUTO_META
    const preferredGroupId = mainTab === 'sort' && activeSortGroupId && groups.some(g => g.id === activeSortGroupId)
      ? activeSortGroupId
      : groups[0]?.id
    linkForm.reset({
      groupId: preferredGroupId ? String(preferredGroupId) : '',
      url: '',
      name: '',
      avatar: '',
      description: '',
      rssUrl: '',
      backlinkUrl: '',
      colorKey: 'sky',
      status: 'approved',
      reviewNote: '',
    })
    setLinkDialogOpen(true)
  }

  const openEditLinkDialog = (item: FriendLinkAdmin) => {
    setEditingLink(item)
    setImmediateDialogAvatar(item.avatar.trim())
    dialogAutoMetaRef.current = {
      source: 'seed',
      siteHost: normalizeFriendUrlHost(item.url),
      description: (item.description || '').trim(),
      rssUrl: (item.rssUrl || '').trim(),
      backlinkUrl: (item.backlinkUrl || '').trim(),
    }
    linkForm.reset({
      groupId: String(item.groupId),
      url: item.url,
      name: item.name,
      avatar: item.avatar,
      description: item.description,
      rssUrl: item.rssUrl || '',
      backlinkUrl: item.backlinkUrl || '',
      colorKey: item.colorKey || 'sky',
      status: item.status,
      reviewNote: item.reviewNote || '',
    })
    setLinkDialogOpen(true)
  }

  const handleDialogAutofill = async () => {
    const rawUrl = linkForm.getValues('url').trim()
    if (!rawUrl) {
      toast.error(friendT('url_required_for_autofill'))
      return
    }
    setAutofilling(true)
    try {
      const res = await autofillFriendLink(rawUrl)
      const data = res.data
      const targetUrl = (data.url || rawUrl).trim()
      if (data.url)
        linkForm.setValue('url', data.url, { shouldValidate: true })
      if (data.name)
        linkForm.setValue('name', data.name, { shouldValidate: true })
      if (data.avatar) {
        setImmediateDialogAvatar(data.avatar.trim())
        linkForm.setValue('avatar', data.avatar, { shouldValidate: true })
      }
      if (data.colorKey)
        linkForm.setValue('colorKey', data.colorKey)

      const { updates, nextMeta } = resolveAutofillOptionalFields({
        targetUrl,
        current: {
          description: linkForm.getValues('description'),
          rssUrl: linkForm.getValues('rssUrl'),
          backlinkUrl: linkForm.getValues('backlinkUrl'),
        },
        incoming: {
          description: data.description,
          rssUrl: data.rssUrl,
          backlinkUrl: data.backlinkUrl,
        },
        prevMeta: dialogAutoMetaRef.current,
      })
      if (updates.description !== undefined)
        linkForm.setValue('description', updates.description, { shouldValidate: true })
      if (updates.rssUrl !== undefined)
        linkForm.setValue('rssUrl', updates.rssUrl, { shouldValidate: true })
      if (updates.backlinkUrl !== undefined)
        linkForm.setValue('backlinkUrl', updates.backlinkUrl, { shouldValidate: true })
      dialogAutoMetaRef.current = nextMeta

      toast.success(friendT('autofill_success'))
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setAutofilling(false)
    }
  }

  const onSubmitLink = async (values: AdminLinkFormValues) => {
    const payload = {
      groupId: Number(values.groupId) || 0,
      name: values.name.trim(),
      url: values.url.trim(),
      avatar: values.avatar.trim(),
      description: values.description.trim(),
      rssUrl: values.rssUrl.trim(),
      backlinkUrl: values.backlinkUrl.trim(),
      colorKey: values.colorKey,
      status: values.status,
      reviewNote: values.reviewNote.trim(),
    }
    const willRunAsyncDiscovery = !editingLink
      || editingLink.url !== payload.url
      || editingLink.backlinkUrl !== payload.backlinkUrl
      || editingLink.rssUrl !== payload.rssUrl
      || editingLink.groupId !== payload.groupId
      || (editingLink.status === 'rejected' && payload.status !== 'rejected')
    try {
      if (editingLink) {
        await adminUpdateFriendLink(editingLink.id, payload)
        toast.success(operationT('update_success'))
      }
      else {
        await adminCreateFriendLink(payload)
        toast.success(operationT('create_success'))
      }
      setLinkDialogOpen(false)
      await Promise.all([fetchLinks(), fetchGroups(), fetchSortOverview({ silent: true })])
      if (willRunAsyncDiscovery)
        setProbeSyncTrigger(n => n + 1)
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleQuickReview = async (item: FriendLinkAdmin, status: FriendStatus, reviewNote = '') => {
    try {
      await adminReviewFriendLink(item.id, { status, reviewNote })
      toast.success(t('review_updated'))
      await Promise.all([fetchLinks(), fetchGroups(), fetchSortOverview({ silent: true })])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const onSubmitReject = async (values: RejectFormValues) => {
    if (!rejectTarget)
      return
    try {
      await adminReviewFriendLink(rejectTarget.id, {
        status: 'rejected',
        reviewNote: values.reviewNote.trim(),
      })
      toast.success(t('review_updated'))
      setRejectTarget(null)
      await Promise.all([fetchLinks(), fetchGroups(), fetchSortOverview({ silent: true })])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleSingleProbe = async (id: number) => {
    setProbingId(id)
    try {
      const res = await adminProbeFriendLink(id)
      linksReqSeqRef.current += 1
      sortReqSeqRef.current += 1
      setLinks(prev => prev.map(item => (item.id === id ? res.data : item)))
      setSortGroups(prev => prev.map(g => ({
        ...g,
        links: g.links.map(item => (item.id === id ? res.data : item)),
      })))
      toast.success(t('probe_single_done'))
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setProbingId(null)
    }
  }

  const handleProbeAll = async () => {
    setProbingAll(true)
    try {
      await adminProbeAllFriendLinks()
      toast.success(t('probe_all_triggered'))
      setProbeSyncTrigger(n => n + 1)
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setProbingAll(false)
    }
  }

  const openCreateGroupDialog = () => {
    setEditingGroup(null)
    groupForm.reset({
      presetKey: 'custom',
      name: '',
      slug: '',
      description: '',
      isPublic: true,
      skipBacklinkCheck: false,
    })
    setGroupDialogOpen(true)
  }

  const openEditGroupDialog = (group: FriendGroupAdmin) => {
    setEditingGroup(group)
    groupForm.reset({
      presetKey: group.presetKey,
      name: group.name,
      slug: group.slug,
      description: group.description,
      isPublic: group.isPublic,
      skipBacklinkCheck: group.skipBacklinkCheck,
    })
    setGroupDialogOpen(true)
  }

  const onSubmitGroup = async (values: AdminGroupFormValues) => {
    const payload = {
      presetKey: values.presetKey,
      name: values.name.trim(),
      slug: values.slug.trim().toLowerCase(),
      description: values.description.trim(),
      sortOrder: editingGroup?.sortOrder,
      isPublic: values.isPublic,
      skipBacklinkCheck: values.skipBacklinkCheck,
    }
    try {
      if (editingGroup) {
        await adminUpdateFriendGroup(editingGroup.id, payload)
        toast.success(operationT('update_success'))
      }
      else {
        await adminCreateFriendGroup(payload)
        toast.success(operationT('create_success'))
      }
      setGroupDialogOpen(false)
      await Promise.all([fetchGroups(), fetchSortOverview({ silent: true })])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleToggleGroupFlag = async (
    group: FriendGroupAdmin,
    patch: Partial<Pick<FriendGroupAdmin, 'isPublic' | 'skipBacklinkCheck'>>,
  ) => {
    try {
      await adminUpdateFriendGroup(group.id, {
        presetKey: group.presetKey,
        name: group.name,
        slug: group.slug,
        description: group.description,
        sortOrder: group.sortOrder,
        isPublic: patch.isPublic ?? group.isPublic,
        skipBacklinkCheck: patch.skipBacklinkCheck ?? group.skipBacklinkCheck,
      })
      await Promise.all([fetchGroups(), fetchSortOverview({ silent: true })])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const persistGroupOrder = async (next: FriendGroupAdmin[]) => {
    if (reordering)
      return
    const prevGroups = groups
    const prevSortGroups = sortGroups
    groupReqSeqRef.current++
    sortReqSeqRef.current++
    setGroups(next)
    setSortGroups((prev) => {
      const byId = new Map(prev.map(item => [item.group.id, item]))
      const reordered: FriendGroupSortItem[] = []
      for (const grp of next) {
        const matched = byId.get(grp.id)
        if (matched)
          reordered.push({ ...matched, group: grp })
      }
      for (const item of prev) {
        if (!next.some(g => g.id === item.group.id))
          reordered.push(item)
      }
      return reordered
    })
    setReordering(true)
    try {
      await adminReorderFriendGroups(next.map(item => item.id))
      toast.success(t('reorder_saved'))
      await Promise.all([fetchGroups({ silent: true }), fetchSortOverview({ silent: true })])
    }
    catch (err) {
      setGroups(prevGroups)
      setSortGroups(prevSortGroups)
      toast.error(errorMessageT(err))
      void fetchGroups({ silent: true, suppressErrorToast: true })
      void fetchSortOverview({ silent: true, suppressErrorToast: true })
    }
    finally {
      setReordering(false)
    }
  }

  const handleMoveGroup = async (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= groups.length || reordering)
      return
    const next = [...groups]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    await persistGroupOrder(next)
  }

  const handleChangeSortMode = async (nextMode: FriendSortMode) => {
    if (nextMode === sortMode || savingSortMode)
      return
    setSavingSortMode(true)
    try {
      const res = await adminUpdateFriendSortMode(nextMode)
      sortReqSeqRef.current++
      setSortMode(res.data.sortMode)
      toast.success(t('sort_mode_saved'))
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setSavingSortMode(false)
    }
  }

  const persistLinkOrder = async (groupId: number, nextLinks: FriendLinkAdmin[]) => {
    if (reorderingLinks)
      return
    const prevSortGroups = sortGroups
    sortReqSeqRef.current++
    setSortGroups(prev => prev.map(item => (item.group.id === groupId ? { ...item, links: nextLinks } : item)))
    setReorderingLinks(true)
    try {
      await adminReorderFriendLinks(groupId, nextLinks.map(item => item.id))
      toast.success(t('links_reorder_saved'))
      await Promise.all([fetchSortOverview({ silent: true }), fetchLinks()])
    }
    catch (err) {
      setSortGroups(prevSortGroups)
      toast.error(errorMessageT(err))
      void fetchSortOverview({ silent: true, suppressErrorToast: true })
    }
    finally {
      setReorderingLinks(false)
    }
  }

  const handleSwitchMainTab = (nextTab: MainTabKey) => {
    setMainTab(nextTab)
    if (nextTab === 'sort' && !reorderingLinks)
      void fetchSortOverview({ silent: sortGroups.length > 0 })
    if (nextTab === 'settings' && !savingSettings && !settingsInFlightRef.current && !isSettingsDirtyRef.current)
      void fetchSettings({ silent: settingsLoaded, suppressErrorToast: settingsLoaded })
  }

  const handleMoveLinkToIndex = async (
    groupId: number,
    groupLinks: FriendLinkAdmin[],
    fromIndex: number,
    toIndex: number,
  ) => {
    if (reorderingLinks || fromIndex < 0 || toIndex < 0 || fromIndex >= groupLinks.length || toIndex >= groupLinks.length || fromIndex === toIndex)
      return
    const next = [...groupLinks]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    await persistLinkOrder(groupId, next)
  }

  const activeSortGroup = useMemo(
    () => sortGroups.find(item => item.group.id === activeSortGroupId) ?? sortGroups[0] ?? null,
    [activeSortGroupId, sortGroups],
  )

  const totalSortableLinks = useMemo(
    () => sortGroups.reduce((acc, item) => acc + item.links.length, 0),
    [sortGroups],
  )

  const primarySiteHost = useMemo(
    () => extractExactHostname(siteInfo?.baseUrl),
    [siteInfo?.baseUrl],
  )

  const renderStatusBadge = (status: FriendStatus, badgeClassName?: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge variant="default" className={cn('bg-emerald-600 text-white hover:bg-emerald-600', badgeClassName)}>
            <span className="truncate">{friendT('status_approved')}</span>
          </Badge>
        )
      case 'pre_approved':
        return (
          <Badge variant="secondary" className={cn('text-amber-600 dark:text-amber-400', badgeClassName)}>
            <span className="truncate">{friendT('status_pre_approved')}</span>
          </Badge>
        )
      case 'rejected':
        return (
          <Badge variant="destructive" className={badgeClassName}>
            <span className="truncate">{friendT('status_rejected')}</span>
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className={badgeClassName}>
            <span className="truncate">{friendT('status_pending')}</span>
          </Badge>
        )
    }
  }

  const renderHealthText = (health: FriendHealthStatus, latencyMs: number, failCount: number) => {
    if (health === 'unreachable')
      return <span className="text-xs font-medium text-destructive">{t('health_unreachable', { fails: failCount })}</span>
    if (health === 'slow')
      return <span className="text-xs text-amber-600 dark:text-amber-400">{t('health_slow', { ms: latencyMs })}</span>
    if (health === 'healthy')
      return <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('health_healthy', { ms: latencyMs })}</span>
    return <span className="text-xs text-muted-foreground">{t('health_unknown')}</span>
  }

  const renderBacklinkBadge = (backlink: FriendBacklinkStatus) => {
    switch (backlink) {
      case 'verified':
        return <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">{t('backlink_verified')}</Badge>
      case 'missing':
        return <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">{t('backlink_missing')}</Badge>
      case 'skipped':
        return <Badge variant="secondary">{t('backlink_skipped')}</Badge>
      default:
        return <Badge variant="outline" className="text-muted-foreground">{t('backlink_unchecked')}</Badge>
    }
  }

  const watchedLink = linkForm.watch()
  const watchedPreset = groupForm.watch('presetKey')
  const debouncedLinkAvatar = useDebouncedValue(watchedLink.avatar, 300)
  const rawWatchedLinkAvatar = watchedLink.avatar.trim()
  const effectiveDialogAvatar = !rawWatchedLinkAvatar
    ? ''
    : (rawWatchedLinkAvatar === editingLink?.avatar || rawWatchedLinkAvatar === immediateDialogAvatar)
        ? rawWatchedLinkAvatar
        : debouncedLinkAvatar.trim()
  const previewLinkAvatar = isPreviewableAvatarUrl(effectiveDialogAvatar) ? effectiveDialogAvatar : ''
  const previewLinkAvatarUrl = previewLinkAvatar && editingLink && previewLinkAvatar === editingLink.avatar
    ? editingLink.avatarUrl
    : undefined

  if (user && !userIsAdmin) {
    return (
      <div className="rounded-xl border bg-card p-10">
        <Empty>
          <EmptyDescription>{t('admin_only')}</EmptyDescription>
        </Empty>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {/* 顶部说明与操作区 */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 max-w-2xl text-sm wrap-anywhere text-muted-foreground">{t('description')}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={probingAll}
            onClick={handleProbeAll}
          >
            <RefreshCwIcon className={`size-4 ${probingAll ? 'animate-spin' : ''}`} />
            {t('probe_all')}
          </Button>
          {mainTab === 'groups' && (
            <Button type="button" size="sm" onClick={openCreateGroupDialog}>
              <FolderPlusIcon className="size-4" />
              {t('add_group')}
            </Button>
          )}
          {(mainTab === 'links' || mainTab === 'sort') && (
            <Button type="button" size="sm" onClick={openCreateLinkDialog}>
              <PlusIcon className="size-4" />
              {t('add_link')}
            </Button>
          )}
        </div>
      </div>

      {/* 主视图切换：全部友链与审核 / 友链排序 / 分组管理与排序联动 / 反链设置 */}
      <Tabs value={mainTab} onValueChange={v => handleSwitchMainTab(v as MainTabKey)} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <TabsList variant="underline" className="w-full max-w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="links" className="flex-none px-3">
            <span>{t('tab_links')}</span>
            {pendingReviewCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs tabular-nums">
                {pendingReviewCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sort" className="flex-none px-3">
            <span>{t('tab_sort')}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{totalSortableLinks}</span>
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex-none px-3">
            <span>{t('tab_groups')}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{groups.length}</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-none px-3">
            <span>{t('tab_settings')}</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: 友链列表与审核工作台 */}
        <TabsContent value="links" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <Tabs
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val)
                setPage(1)
              }}
              className="grid max-w-full min-w-0 grid-cols-[minmax(0,1fr)]"
            >
              <TabsList className="w-fit max-w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsTrigger value="all" className="flex-none">{t('filter_all')}</TabsTrigger>
                <TabsTrigger value="pre_approved" className="flex-none">{friendT('status_pre_approved')}</TabsTrigger>
                <TabsTrigger value="pending" className="flex-none">{friendT('status_pending')}</TabsTrigger>
                <TabsTrigger value="approved" className="flex-none">{friendT('status_approved')}</TabsTrigger>
                <TabsTrigger value="rejected" className="flex-none">{friendT('status_rejected')}</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 sm:w-auto">
              <Select
                value={groupFilter}
                onValueChange={(val) => {
                  setGroupFilter(val)
                  setPage(1)
                }}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('all_groups')}</SelectItem>
                  {groups.map(g => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {presetT.groupName(g.presetKey, g.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-full sm:w-60">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value)
                    setPage(1)
                  }}
                  placeholder={t('search_placeholder')}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] dark:shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">{t('col_card')}</TableHead>
                  <TableHead>{t('col_group')}</TableHead>
                  <TableHead>{t('col_submitter')}</TableHead>
                  <TableHead>{t('col_probe')}</TableHead>
                  <TableHead className="min-w-[200px]">{t('col_status')}</TableHead>
                  <TableHead className={`text-right ${STICKY_ACTIONS_CLASS}`}>{t('col_actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linksLoading && links.length === 0 && Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    {Array.from({ length: 6 }, (_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))}

                {!linksLoading && links.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12">
                      <Empty>
                        <EmptyDescription>{t('empty_links')}</EmptyDescription>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}

                {links.map((item) => {
                  const grp = groupMap.get(item.groupId)
                  const groupLabel = grp ? presetT.groupName(grp.presetKey, grp.name) : `#${item.groupId}`
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="py-3">
                        <div className="grid max-w-[270px] gap-1.5">
                          <FriendCard
                            interactive={false}
                            item={{
                              name: item.name,
                              url: item.url,
                              avatar: item.avatar,
                              avatarUrl: item.avatarUrl,
                              description: item.description,
                              colorKey: item.colorKey,
                              healthStatus: item.healthStatus,
                              latencyMs: item.latencyMs,
                              techStack: item.techStack,
                            }}
                          />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <span className="truncate">{item.url}</span>
                            <ExternalLinkIcon className="size-3 shrink-0" />
                          </a>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="grid gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{groupLabel}</span>
                            {grp && !grp.isPublic && (
                              <Badge variant="outline" className="gap-1 text-xs">
                                <EyeOffIcon className="size-3" />
                                {t('private_badge')}
                              </Badge>
                            )}
                          </div>
                          {item.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveSortGroupId(item.groupId)
                                handleSwitchMainTab('sort')
                              }}
                              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                            >
                              <ArrowUpDownIcon className="size-3" />
                              <span>{t('action_jump_sort')}</span>
                            </button>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {item.user?.username ? `@${item.user.username}` : t('submitter_system')}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="grid gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderHealthText(item.healthStatus, item.latencyMs, item.failCount)}
                            {renderBacklinkBadge(item.backlinkStatus)}
                            {item.rssUrl && /^https?:\/\//i.test(item.rssUrl)
                              ? (
                                  <Badge
                                    asChild
                                    variant="outline"
                                    className="gap-1 border-sky-500/40 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
                                  >
                                    <a
                                      href={item.rssUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={item.rssUrl}
                                    >
                                      <RssIcon className="size-3" aria-hidden />
                                      {t('rss_bound')}
                                    </a>
                                  </Badge>
                                )
                              : (
                                  <Badge variant="outline" className="text-muted-foreground">
                                    {t('rss_empty')}
                                  </Badge>
                                )}
                          </div>
                          {item.lastCheckedAt && (
                            <span className="text-xs text-muted-foreground">
                              {format.dateTime(new Date(item.lastCheckedAt), { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-normal">
                        <div className="grid gap-1">
                          <div>{renderStatusBadge(item.status)}</div>
                          {item.reviewNote && (
                            <p className="line-clamp-2 max-w-[240px] text-xs wrap-anywhere text-muted-foreground">
                              {item.reviewNote}
                            </p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className={`text-right ${STICKY_ACTIONS_CLASS}`}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {item.status !== 'approved' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="hidden sm:inline-flex"
                              onClick={() => handleQuickReview(item, 'approved', item.reviewNote)}
                            >
                              <CheckIcon className="size-3.5 text-emerald-600" />
                              {t('action_approve')}
                            </Button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('col_actions')}>
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditLinkDialog(item)}>
                                <PencilIcon className="size-4" />
                                {operationT('edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setUserKeyword('')
                                  setTransferTarget(item)
                                }}
                              >
                                <UserRoundCheckIcon className="size-4" />
                                {t('action_transfer')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={probingId === item.id}
                                onClick={() => handleSingleProbe(item.id)}
                              >
                                <RadioIcon className="size-4" />
                                {t('action_probe_single')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {item.status !== 'approved' && (
                                <DropdownMenuItem onClick={() => handleQuickReview(item, 'approved', item.reviewNote)}>
                                  <CheckIcon className="size-4" />
                                  {t('action_approve')}
                                </DropdownMenuItem>
                              )}
                              {item.status !== 'pre_approved' && (
                                <DropdownMenuItem onClick={() => handleQuickReview(item, 'pre_approved', item.reviewNote)}>
                                  <ClockIcon className="size-4" />
                                  {t('action_pre_approve')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => {
                                  rejectForm.reset({ reviewNote: item.reviewNote || '' })
                                  setRejectTarget(item)
                                }}
                              >
                                <XCircleIcon className="size-4" />
                                {t('action_reject')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteLinkTarget(item)}
                              >
                                <Trash2Icon className="size-4" />
                                {operationT('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <PaginationController
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            hideOnSinglePage
            onPageChange={setPage}
          />
        </TabsContent>

        {/* Tab 2: 友链默认排序策略与分组内拖拽排序 */}
        <TabsContent value="sort" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {/* 卡片 1：前台默认排序方式 */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 overflow-x-clip rounded-xl border bg-card p-3.5 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] sm:p-4 dark:shadow-none">
            <div className="grid min-w-0 gap-1">
              <h3 className="text-sm font-semibold">{t('sort_mode_title')}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('sort_mode_desc')}</p>
            </div>

            <div role="group" aria-label={t('sort_mode_title')} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={sortMode === 'manual'}
                disabled={savingSortMode}
                onClick={() => handleChangeSortMode('manual')}
                className={cn(
                  'flex min-w-0 flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                  sortMode === 'manual'
                    ? 'border-primary/60 bg-primary/[0.04] ring-1 ring-primary/25'
                    : 'bg-background/60 hover:bg-muted/50',
                )}
              >
                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
                    <ListOrderedIcon className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="wrap-anywhere">{t('sort_mode_manual')}</span>
                  </span>
                  {sortMode === 'manual' && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-3" aria-hidden />
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed wrap-anywhere text-muted-foreground">
                  {t('sort_mode_manual_desc')}
                </p>
              </button>

              <button
                type="button"
                aria-pressed={sortMode === 'activity'}
                disabled
                aria-disabled="true"
                className={cn(
                  'flex min-w-0 cursor-not-allowed flex-col items-start gap-1.5 rounded-xl border border-dashed bg-muted/25 p-3.5 text-left opacity-80',
                  sortMode === 'activity' && 'border-primary/60 bg-primary/[0.04] ring-1 ring-primary/25',
                )}
              >
                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground/85">
                    <RssIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="wrap-anywhere">{t('sort_mode_activity')}</span>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[11px]">
                    {t('sort_mode_pending_rss_badge')}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed wrap-anywhere text-muted-foreground">
                  {t('sort_mode_activity_desc')}
                </p>
              </button>
            </div>
          </div>

          {/* 卡片 2：分组内友链拖拽排序 */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 overflow-x-clip rounded-xl border bg-card p-3.5 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] sm:p-4 dark:shadow-none">
            <div className="grid min-w-0 gap-1">
              <h3 className="text-sm font-semibold">{t('links_sort_title')}</h3>
              <p className="text-xs leading-relaxed wrap-anywhere text-muted-foreground">{t('links_sort_desc')}</p>
            </div>

            {sortLoading && sortGroups.length === 0
              ? (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                    <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={`s-skel-${i}`} className="h-14 w-full rounded-xl" />
                    ))}
                  </div>
                )
              : sortGroups.length === 0
                ? (
                    <div className="rounded-xl border border-dashed py-10">
                      <Empty>
                        <EmptyDescription>{t('links_sort_no_groups')}</EmptyDescription>
                      </Empty>
                    </div>
                  )
                : (
                    <>
                      {activeSortGroup && (
                        <Tabs
                          value={String(activeSortGroup.group.id)}
                          onValueChange={val => setActiveSortGroupId(Number(val))}
                          className="grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)]"
                        >
                          <TabsList
                            ref={sortGroupTabListRef}
                            className="w-fit max-w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                          >
                            {sortGroups.map((groupItem) => {
                              const grp = groupItem.group
                              return (
                                <TabsTrigger key={grp.id} value={String(grp.id)} className="flex-none gap-1.5">
                                  <span className="max-w-40 truncate sm:max-w-48">{presetT.groupName(grp.presetKey, grp.name)}</span>
                                  {!grp.isPublic && (
                                    <>
                                      <EyeOffIcon className="size-3 shrink-0 opacity-75" aria-hidden />
                                      <span className="sr-only">{t('private_badge')}</span>
                                    </>
                                  )}
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {groupItem.links.length}
                                  </span>
                                </TabsTrigger>
                              )
                            })}
                          </TabsList>
                        </Tabs>
                      )}

                      {!activeSortGroup || activeSortGroup.links.length === 0
                        ? (
                            <div className="rounded-xl border border-dashed py-10">
                              <Empty>
                                <EmptyDescription>{t('links_sort_empty')}</EmptyDescription>
                              </Empty>
                            </div>
                          )
                        : (
                            <SortableList
                              key={activeSortGroup.group.id}
                              items={activeSortGroup.links}
                              getId={item => item.id}
                              disabled={reorderingLinks}
                              itemClassName="rounded-xl"
                              onReorder={next => void persistLinkOrder(activeSortGroup.group.id, next)}
                              renderItem={(item, idx, dragCtx) => {
                                const palette = resolveFriendPalette(item.colorKey)
                                const primaryAvatar = item.avatarUrl || item.avatar || undefined
                                const backupAvatar = item.avatarUrl && item.avatarUrl !== item.avatar ? item.avatar : undefined
                                const initial = (item.name || '?').trim().slice(0, 1).toUpperCase()
                                return (
                                  <div
                                    className={cn(
                                      'flex w-full min-w-0 items-center gap-2 rounded-xl border bg-background/60 px-2.5 py-2 transition-colors sm:gap-2.5 sm:px-3 sm:py-2.5',
                                      dragCtx.isDragging && 'border-primary/40 bg-card',
                                    )}
                                  >
                                    <SortableDragHandle
                                      ctx={dragCtx}
                                      disabled={activeSortGroup.links.length <= 1}
                                      busy={reorderingLinks}
                                      label={t('drag_handle_label')}
                                      className="-ml-1"
                                    />

                                    <span className="min-w-5 shrink-0 text-center font-mono text-[11px] text-muted-foreground tabular-nums sm:min-w-6 sm:px-0.5 sm:text-xs">
                                      #
                                      {idx + 1}
                                    </span>

                                    <ImageAvatar
                                      src={primaryAvatar}
                                      fallbackSrc={backupAvatar}
                                      alt=""
                                      fallback={initial}
                                      sizes="36px"
                                      fallbackDelayMs={150}
                                      className="size-8 shrink-0 ring-1 ring-border/60 sm:size-9"
                                      fallbackClassName="text-xs font-bold text-white"
                                      fallbackStyle={{ backgroundColor: `oklch(0.54 ${Math.max(palette.c, 0.08)} ${palette.h})` }}
                                    />

                                    <div className="min-w-0 flex-1 overflow-hidden">
                                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                                        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                                          <span
                                            className="size-2 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                                            style={{ backgroundColor: palette.hex }}
                                            aria-hidden
                                          />
                                          <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
                                        </span>
                                        {item.status !== 'approved' && renderStatusBadge(item.status, 'max-w-full min-w-0 shrink')}
                                      </div>
                                      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                                        <span className="min-w-0 truncate font-mono">{item.url}</span>
                                        {item.description && (
                                          <span className="hidden min-w-0 truncate md:inline">
                                            ·
                                            {' '}
                                            {item.description}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="ml-auto hidden shrink-0 items-center gap-0.5 sm:flex">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        title={t('action_move_top')}
                                        aria-label={t('action_move_top')}
                                        disabled={idx === 0 || reorderingLinks}
                                        onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, 0)}
                                      >
                                        <ArrowUpToLineIcon className="size-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        title={t('action_move_up')}
                                        aria-label={t('action_move_up')}
                                        disabled={idx === 0 || reorderingLinks}
                                        onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, idx - 1)}
                                      >
                                        <ArrowUpIcon className="size-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        title={t('action_move_down')}
                                        aria-label={t('action_move_down')}
                                        disabled={idx === activeSortGroup.links.length - 1 || reorderingLinks}
                                        onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, idx + 1)}
                                      >
                                        <ArrowDownIcon className="size-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        title={operationT('edit')}
                                        aria-label={operationT('edit')}
                                        onClick={() => openEditLinkDialog(item)}
                                      >
                                        <PencilIcon className="size-3.5" />
                                      </Button>
                                    </div>

                                    <div className="ml-auto flex shrink-0 sm:hidden">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-8"
                                            aria-label={t('col_actions')}
                                          >
                                            <MoreHorizontalIcon className="size-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem
                                            disabled={idx === 0 || reorderingLinks}
                                            onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, 0)}
                                          >
                                            <ArrowUpToLineIcon className="size-4" />
                                            {t('action_move_top')}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={idx === 0 || reorderingLinks}
                                            onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, idx - 1)}
                                          >
                                            <ArrowUpIcon className="size-4" />
                                            {t('action_move_up')}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={idx === activeSortGroup.links.length - 1 || reorderingLinks}
                                            onClick={() => handleMoveLinkToIndex(activeSortGroup.group.id, activeSortGroup.links, idx, idx + 1)}
                                          >
                                            <ArrowDownIcon className="size-4" />
                                            {t('action_move_down')}
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => openEditLinkDialog(item)}>
                                            <PencilIcon className="size-4" />
                                            {operationT('edit')}
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>
                                )
                              }}
                            />
                          )}
                    </>
                  )}
          </div>
        </TabsContent>

        {/* Tab 3: 分组管理与前台顺序联动 */}
        <TabsContent value="groups" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="rounded-xl border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed wrap-anywhere text-muted-foreground sm:px-4">
            {t('groups_order_hint')}
          </div>

          {groupsLoading && groups.length === 0
            ? (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={`g-skel-${i}`} className="h-14 w-full rounded-xl" />
                  ))}
                </div>
              )
            : (
                <SortableList
                  items={groups}
                  getId={g => g.id}
                  disabled={reordering}
                  itemClassName="rounded-xl"
                  onReorder={next => void persistGroupOrder(next)}
                  renderItem={(group, idx, dragCtx) => (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-3 overflow-x-clip rounded-xl border bg-card px-3 py-2.5 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] sm:px-3.5 sm:py-3 dark:shadow-none">
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <SortableDragHandle
                          ctx={dragCtx}
                          disabled={groups.length <= 1}
                          busy={reordering}
                          label={t('drag_handle_label')}
                          className="-ml-1"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                            <span className="text-sm font-medium wrap-anywhere">
                              {presetT.groupName(group.presetKey, group.name)}
                            </span>
                            <Badge variant="outline" className="font-mono text-[11px]">
                              {group.presetKey}
                            </Badge>
                            <code className="max-w-full rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all text-muted-foreground">
                              ?group=
                              {group.slug}
                            </code>
                            <Badge variant="secondary" className="tabular-nums">
                              {group.linkCount}
                            </Badge>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs wrap-anywhere text-muted-foreground">
                            {presetT.groupDescription(group.presetKey, group.description)}
                          </p>
                        </div>
                      </div>

                      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2.5 border-t pt-2.5 sm:ml-auto sm:w-auto sm:justify-end sm:gap-3 sm:border-t-0 sm:pt-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                            <Switch
                              checked={group.isPublic}
                              onCheckedChange={checked => handleToggleGroupFlag(group, { isPublic: checked })}
                            />
                            <span>{t('col_public')}</span>
                          </label>

                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                            <Switch
                              checked={group.skipBacklinkCheck}
                              onCheckedChange={checked => handleToggleGroupFlag(group, { skipBacklinkCheck: checked })}
                            />
                            <span>{t('col_skip_backlink')}</span>
                          </label>
                        </div>

                        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 sm:size-7"
                            title={t('action_move_up')}
                            aria-label={t('action_move_up')}
                            disabled={idx === 0 || reordering}
                            onClick={() => handleMoveGroup(idx, -1)}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 sm:size-7"
                            title={t('action_move_down')}
                            aria-label={t('action_move_down')}
                            disabled={idx === groups.length - 1 || reordering}
                            onClick={() => handleMoveGroup(idx, 1)}
                          >
                            <ArrowDownIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditGroupDialog(group)}
                          >
                            <PencilIcon className="size-3.5" />
                            {operationT('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={group.linkCount > 0}
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteGroupTarget(group)}
                          >
                            <Trash2Icon className="size-3.5" />
                            {operationT('delete')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                />
              )}
        </TabsContent>
        {/* Tab 4: 友链全局设置（拨测与连接策略 + 反链别名域名） */}
        <TabsContent value="settings" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {!settingsLoaded && settingsLoading
            ? (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border bg-card p-3.5 sm:p-5">
                  <Skeleton className="h-5 w-44 rounded" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                </div>
              )
            : !settingsLoaded && settingsLoadError
                ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card py-10 text-center">
                      <p className="px-4 text-xs leading-relaxed wrap-anywhere text-muted-foreground">
                        {t('backlink_alias_load_failed')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={settingsLoading}
                        onClick={() => void fetchSettings()}
                      >
                        <RefreshCwIcon className={cn('size-3.5', settingsLoading && 'animate-spin')} />
                        {t('backlink_alias_retry')}
                      </Button>
                    </div>
                  )
                : (
                    <Form {...settingsForm}>
                      <form
                        noValidate
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
                        onSubmit={settingsForm.handleSubmit(onSubmitSettings)}
                      >
                        {/* 卡片 1：拨测与连接策略 */}
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 overflow-x-clip rounded-xl border bg-card p-3.5 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] sm:p-5 dark:shadow-none">
                          <div className="grid min-w-0 gap-1">
                            <h3 className="text-sm font-semibold">{t('probe_policy_title')}</h3>
                            <p className="text-xs leading-relaxed wrap-anywhere text-muted-foreground">{t('probe_policy_desc')}</p>
                          </div>

                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border p-3.5">
                            <FormField
                              control={settingsForm.control}
                              name="allowRedirects"
                              render={({ field }) => (
                                <FormItem className="flex items-start justify-between gap-3">
                                  <div className="grid min-w-0 gap-1">
                                    <FormLabel className="leading-snug">{t('settings_allow_redirects')}</FormLabel>
                                    <FormDescription className="text-xs leading-relaxed wrap-anywhere">
                                      {t('settings_allow_redirects_desc')}
                                    </FormDescription>
                                  </div>
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={(checked) => {
                                        if (!checked)
                                          settingsForm.clearErrors('maxRedirects')
                                        field.onChange(checked)
                                      }}
                                      className="mt-0.5 shrink-0"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={settingsForm.control}
                              name="maxRedirects"
                              render={({ field }) => (
                                <FormItem
                                  className={cn(
                                    'grid min-w-0 gap-2 border-t pt-3 transition-opacity',
                                    !watchedAllowRedirects && 'opacity-60',
                                  )}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="grid min-w-0 flex-1 basis-44 gap-0.5">
                                      <FormLabel className="leading-snug">{t('settings_max_redirects')}</FormLabel>
                                      <FormDescription className="text-xs leading-relaxed wrap-anywhere">
                                        {t('settings_max_redirects_hint')}
                                      </FormDescription>
                                    </div>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={10}
                                        step={1}
                                        disabled={!watchedAllowRedirects}
                                        onChange={(e) => {
                                          settingsForm.clearErrors('maxRedirects')
                                          field.onChange(e.target.value)
                                        }}
                                        className="w-24 shrink-0 tabular-nums"
                                      />
                                    </FormControl>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={settingsForm.control}
                            name="allowNonStandardPorts"
                            render={({ field }) => (
                              <FormItem className="flex items-start justify-between gap-3 rounded-lg border p-3.5">
                                <div className="grid min-w-0 gap-1">
                                  <FormLabel className="leading-snug">{t('settings_allow_non_standard_ports')}</FormLabel>
                                  <FormDescription className="text-xs leading-relaxed wrap-anywhere">
                                    {t('settings_allow_non_standard_ports_desc')}
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5 shrink-0" />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* 卡片 2：反链别名域名 */}
                        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-x-clip rounded-xl border bg-card p-3.5 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] sm:p-5 dark:shadow-none">
                          <div className="grid min-w-0 gap-1">
                            <h3 className="text-sm font-semibold">{t('backlink_alias_title')}</h3>
                            <p className="text-xs leading-relaxed wrap-anywhere text-muted-foreground">{t('backlink_alias_desc')}</p>
                          </div>

                          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/25 px-3 py-2.5 text-xs">
                            <div className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="shrink-0 text-muted-foreground">
                                {t('backlink_primary_host_label')}
                                :
                              </span>
                              {primarySiteHost
                                ? (
                                    <Badge variant="outline" className="max-w-full min-w-0 shrink font-mono text-xs">
                                      <span className="truncate">{primarySiteHost}</span>
                                    </Badge>
                                  )
                                : (
                                    <span className="text-muted-foreground">{t('backlink_primary_host_unset')}</span>
                                  )}
                            </div>

                            {aliasHosts.length > 0 && (
                              <div className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="shrink-0 text-muted-foreground">
                                  {t('backlink_alias_active_label')}
                                  :
                                </span>
                                {aliasHosts.map(host => (
                                  <Badge key={host} variant="secondary" className="max-w-full min-w-0 shrink font-mono text-xs">
                                    <span className="truncate">{host}</span>
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>

                          <FormField
                            control={settingsForm.control}
                            name="aliasHostsText"
                            render={({ field }) => (
                              <FormItem className="grid min-w-0 gap-2">
                                <FormLabel className="leading-snug">{t('backlink_alias_label')}</FormLabel>
                                <FormControl>
                                  <Textarea
                                    {...field}
                                    rows={4}
                                    spellCheck={false}
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    className="font-mono"
                                    placeholder={t('backlink_alias_placeholder')}
                                  />
                                </FormControl>
                                <FormDescription className="text-xs leading-relaxed wrap-anywhere">
                                  {t('backlink_alias_hint')}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <Button type="submit" size="sm" disabled={savingSettings || settingsLoading || !settingsLoaded}>
                            {savingSettings && <Loader2Icon className="size-4 animate-spin" />}
                            {operationT('save')}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  )}
        </TabsContent>
      </Tabs>

      {/* 新建 / 编辑友链弹窗 */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">{editingLink ? t('edit_link_title') : t('add_link')}</DialogTitle>
            <DialogDescription>{t('link_dialog_desc')}</DialogDescription>
          </DialogHeader>

          <Form {...linkForm}>
            <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" onSubmit={linkForm.handleSubmit(onSubmitLink)}>
              <FormField
                control={linkForm.control}
                name="url"
                rules={{ validate: v => v.trim() !== '' || friendT('field_url_required') }}
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{friendT('field_url')}</FormLabel>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <FormControl>
                        <Input {...field} type="text" inputMode="url" maxLength={512} placeholder="https://example.com" />
                      </FormControl>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={autofilling}
                        onClick={handleDialogAutofill}
                        className="shrink-0"
                      >
                        {autofilling
                          ? <Loader2Icon className="size-4 animate-spin" />
                          : <SparklesIcon className="size-4" />}
                        {friendT('autofill_button')}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <FormField
                  control={linkForm.control}
                  name="name"
                  rules={{ validate: v => v.trim() !== '' || friendT('field_name_required') }}
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{friendT('field_name')}</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={64} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={linkForm.control}
                  name="groupId"
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{friendT('field_group')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {groups.map(g => (
                            <SelectItem key={g.id} value={String(g.id)}>
                              {presetT.groupName(g.presetKey, g.name)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <FormField
                  control={linkForm.control}
                  name="avatar"
                  rules={{ validate: v => v.trim() !== '' || friendT('field_avatar_required') }}
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{friendT('field_avatar')}</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" inputMode="url" maxLength={512} placeholder="https://example.com/avatar.png" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={linkForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{t('field_status')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {FRIEND_STATUSES.map(st => (
                            <SelectItem key={st} value={st}>
                              {st === 'approved'
                                ? friendT('status_approved')
                                : st === 'pre_approved'
                                  ? friendT('status_pre_approved')
                                  : st === 'rejected'
                                    ? friendT('status_rejected')
                                    : friendT('status_pending')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <FormField
                  control={linkForm.control}
                  name="rssUrl"
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel className="leading-snug">{friendT('field_rss_url')}</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" inputMode="url" maxLength={512} placeholder={friendT('field_rss_placeholder')} />
                      </FormControl>
                      <FormDescription className="text-xs leading-normal">
                        {friendT('auto_detect_if_blank')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={linkForm.control}
                  name="backlinkUrl"
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel className="leading-snug">{friendT('field_backlink_url')}</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" inputMode="url" maxLength={512} placeholder={friendT('field_backlink_placeholder')} />
                      </FormControl>
                      <FormDescription className="text-xs leading-normal">
                        {friendT('auto_detect_if_blank')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={linkForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{friendT('field_description')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} maxLength={200} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={linkForm.control}
                name="reviewNote"
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{t('field_review_note')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={500} placeholder={t('field_review_note_placeholder')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={linkForm.control}
                name="colorKey"
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{friendT('field_color')}</FormLabel>
                    <FormControl>
                      <FriendColorPicker
                        value={field.value}
                        seedText={`${watchedLink.name}${watchedLink.url}`}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid min-w-0 gap-2">
                <span className="text-xs font-medium text-muted-foreground">{friendT('live_preview')}</span>
                <div className="max-w-sm min-w-0">
                  <FriendCard
                    interactive={false}
                    item={{
                      name: watchedLink.name,
                      url: watchedLink.url || 'https://example.com',
                      avatar: previewLinkAvatar,
                      avatarUrl: previewLinkAvatarUrl,
                      description: watchedLink.description,
                      colorKey: watchedLink.colorKey,
                      healthStatus: 'healthy',
                      latencyMs: 160,
                    }}
                  />
                </div>
              </div>

              <DialogFooter>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(false)}>
                    {operationT('cancel')}
                  </Button>
                  <Button type="submit" disabled={linkForm.formState.isSubmitting}>
                    {operationT('save')}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 驳回原因填写弹窗 */}
      <Dialog open={rejectTarget !== null} onOpenChange={open => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">{t('reject_dialog_title', { name: rejectTarget?.name || '' })}</DialogTitle>
            <DialogDescription>{t('reject_dialog_desc')}</DialogDescription>
          </DialogHeader>
          <Form {...rejectForm}>
            <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" onSubmit={rejectForm.handleSubmit(onSubmitReject)}>
              <FormField
                control={rejectForm.control}
                name="reviewNote"
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{t('field_review_note')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} maxLength={500} placeholder={t('reject_note_placeholder')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
                    {operationT('cancel')}
                  </Button>
                  <Button type="submit" variant="destructive" disabled={rejectForm.formState.isSubmitting}>
                    {t('action_reject')}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 新建 / 编辑分组弹窗 */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? t('edit_group_title') : t('add_group')}</DialogTitle>
            <DialogDescription>{t('group_dialog_desc')}</DialogDescription>
          </DialogHeader>

          <Form {...groupForm}>
            <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" onSubmit={groupForm.handleSubmit(onSubmitGroup)}>
              <FormField
                control={groupForm.control}
                name="presetKey"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <FormLabel>{t('field_preset_key')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(val) => {
                        field.onChange(val)
                        if (val !== 'custom' && !groupForm.getValues('slug'))
                          groupForm.setValue('slug', val)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FRIEND_GROUP_PRESETS.map(key => (
                          <SelectItem key={key} value={key}>
                            {key === 'custom'
                              ? t('preset_custom')
                              : `${presetT.groupName(key, '')} (${key})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <FormField
                  control={groupForm.control}
                  name="name"
                  rules={{
                    validate: v => watchedPreset !== 'custom' || v.trim() !== '' || t('group_name_required'),
                  }}
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{t('col_group_name')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={64}
                          placeholder={watchedPreset === 'custom' ? t('custom_group_name_placeholder') : t('preset_name_optional')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={groupForm.control}
                  name="slug"
                  rules={{
                    validate: v => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.trim().toLowerCase()) || t('group_slug_invalid'),
                  }}
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{t('col_slug')}</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={64} placeholder="my-friends" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={groupForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="grid min-w-0 gap-2">
                    <FormLabel>{friendT('field_description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        maxLength={255}
                        placeholder={t('group_desc_placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={groupForm.control}
                name="isPublic"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="grid gap-0.5">
                      <FormLabel>{t('col_public')}</FormLabel>
                      <span className="text-xs text-muted-foreground">{t('field_public_hint')}</span>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={groupForm.control}
                name="skipBacklinkCheck"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="grid gap-0.5">
                      <FormLabel>{t('col_skip_backlink')}</FormLabel>
                      <span className="text-xs text-muted-foreground">{t('field_skip_backlink_hint')}</span>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setGroupDialogOpen(false)}>
                    {operationT('cancel')}
                  </Button>
                  <Button type="submit" disabled={groupForm.formState.isSubmitting}>
                    {operationT('save')}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 转移友链归属用户弹窗 */}
      <Dialog open={transferTarget !== null} onOpenChange={open => !open && setTransferTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">{t('transfer_dialog_title', { name: transferTarget?.name || '' })}</DialogTitle>
            <DialogDescription>{t('transfer_dialog_desc')}</DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">
                {t('transfer_current_owner', {
                  owner: transferTarget?.user?.username ? `@${transferTarget.user.username}` : t('submitter_system'),
                })}
              </span>
              {transferTarget && transferTarget.userId > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  disabled={transferring}
                  onClick={() => handleTransferOwner(0)}
                >
                  {t('transfer_reclaim_system')}
                </Button>
              )}
            </div>

            <div className="relative min-w-0">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={userKeyword}
                onChange={e => setUserKeyword(e.target.value)}
                placeholder={t('transfer_search_placeholder')}
                className="pl-8"
              />
            </div>

            <div className="grid max-h-60 min-w-0 grid-cols-[minmax(0,1fr)] gap-1 overflow-y-auto">
              {usersLoading && candidateUsers.length === 0
                ? (
                    <div className="grid gap-1.5 py-2">
                      <Skeleton className="h-10 w-full rounded-lg" />
                      <Skeleton className="h-10 w-full rounded-lg" />
                    </div>
                  )
                : candidateUsers.length === 0
                  ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">{t('transfer_empty_users')}</p>
                    )
                  : candidateUsers.map(candidate => (
                      <button
                        key={candidate.id}
                        type="button"
                        disabled={transferring || candidate.id === transferTarget?.userId}
                        onClick={() => handleTransferOwner(candidate.id)}
                        className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <UserAvatar user={candidate} className="size-7 shrink-0" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {candidate.nickname || candidate.username}
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                @
                                {candidate.username}
                              </span>
                            </div>
                            {candidate.email && (
                              <div className="truncate text-xs text-muted-foreground">{candidate.email}</div>
                            )}
                          </div>
                        </div>
                        {candidate.id === transferTarget?.userId && (
                          <CheckIcon className="size-4 shrink-0 text-primary" />
                        )}
                      </button>
                    ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransferTarget(null)}>
              {operationT('cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除友链确认弹窗 */}
      <ConfirmDialog
        open={deleteLinkTarget !== null}
        onOpenChange={open => !open && setDeleteLinkTarget(null)}
        title={t('delete_link_title', { name: deleteLinkTarget?.name || '' })}
        description={t('delete_link_desc')}
        confirmLabel={operationT('delete')}
        onConfirm={async () => {
          if (!deleteLinkTarget)
            return
          await adminDeleteFriendLink(deleteLinkTarget.id)
          toast.success(operationT('delete_success'))
          setDeleteLinkTarget(null)
          await Promise.all([fetchLinks(), fetchGroups(), fetchSortOverview({ silent: true })])
        }}
      />

      {/* 删除分组确认弹窗 */}
      <ConfirmDialog
        open={deleteGroupTarget !== null}
        onOpenChange={open => !open && setDeleteGroupTarget(null)}
        title={t('delete_group_title', { name: deleteGroupTarget ? presetT.groupName(deleteGroupTarget.presetKey, deleteGroupTarget.name) : '' })}
        description={t('delete_group_desc')}
        confirmLabel={operationT('delete')}
        onConfirm={async () => {
          if (!deleteGroupTarget)
            return
          await adminDeleteFriendGroup(deleteGroupTarget.id)
          toast.success(operationT('delete_success'))
          setDeleteGroupTarget(null)
          await Promise.all([fetchGroups(), fetchSortOverview({ silent: true })])
        }}
      />
    </div>
  )
}
