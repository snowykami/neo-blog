'use client'

import type {
  FriendBacklinkStatus,
  FriendColorKey,
  FriendGroupAdmin,
  FriendGroupPresetKey,
  FriendHealthStatus,
  FriendLinkAdmin,
  FriendStatus,
} from '@/models/friend'
import type { User } from '@/models/user'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  FolderPlusIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundCheckIcon,
  XCircleIcon,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { listUsers } from '@/api/admin'
import {
  adminCreateFriendGroup,
  adminCreateFriendLink,
  adminDeleteFriendGroup,
  adminDeleteFriendLink,
  adminListFriendGroups,
  adminListFriendLinks,
  adminProbeAllFriendLinks,
  adminProbeFriendLink,
  adminReorderFriendGroups,
  adminReviewFriendLink,
  adminTransferFriendLink,
  adminUpdateFriendGroup,
  adminUpdateFriendLink,
  autofillFriendLink,
} from '@/api/friend'
import { UserAvatar } from '@/components/common/avatar'
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
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
import { useDebouncedState, useDebouncedValue } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { FRIEND_GROUP_PRESETS, FRIEND_STATUSES, isPreviewableAvatarUrl } from '@/models/friend'
import { isAdmin } from '@/utils/common/permission'

const PAGE_SIZE = 20

interface AdminLinkFormValues {
  groupId: string
  url: string
  name: string
  avatar: string
  description: string
  backlinkUrl: string
  colorKey: FriendColorKey
  sortOrder: string
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

export function FriendManage() {
  const t = useTranslations('Console.friends')
  const friendT = useTranslations('Friends')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const format = useFormatter()
  const presetT = useFriendPresetTranslator()
  const { user } = useAuth()

  const [mainTab, setMainTab] = useState<'links' | 'groups'>('links')
  const [groups, setGroups] = useState<FriendGroupAdmin[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)

  const [links, setLinks] = useState<FriendLinkAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [linksLoading, setLinksLoading] = useState(true)

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

  const fetchGroups = useCallback(async () => {
    if (!userIsAdmin)
      return
    setGroupsLoading(true)
    try {
      const res = await adminListFriendGroups()
      setGroups(res.data.groups || [])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setGroupsLoading(false)
    }
  }, [errorMessageT, userIsAdmin])

  const fetchLinks = useCallback(async () => {
    if (!userIsAdmin)
      return
    setLinksLoading(true)
    try {
      const res = await adminListFriendLinks({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
        groupId: groupFilter === 'all' ? undefined : Number(groupFilter),
        keyword: debouncedKeyword.trim() || undefined,
      })
      setLinks(res.data.links || [])
      setTotal(res.data.total || 0)
      setPendingReviewCount(res.data.pendingReviewCount || 0)
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
    finally {
      setLinksLoading(false)
    }
  }, [debouncedKeyword, errorMessageT, groupFilter, page, statusFilter, userIsAdmin])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

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
      setLinks(prev => prev.map(item => (item.id === transferTarget.id ? res.data : item)))
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
      backlinkUrl: '',
      colorKey: 'sky',
      sortOrder: '0',
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

  const openCreateLinkDialog = () => {
    setEditingLink(null)
    setImmediateDialogAvatar('')
    linkForm.reset({
      groupId: groups[0]?.id ? String(groups[0].id) : '',
      url: '',
      name: '',
      avatar: '',
      description: '',
      backlinkUrl: '',
      colorKey: 'sky',
      sortOrder: '0',
      status: 'approved',
      reviewNote: '',
    })
    setLinkDialogOpen(true)
  }

  const openEditLinkDialog = (item: FriendLinkAdmin) => {
    setEditingLink(item)
    setImmediateDialogAvatar(item.avatar.trim())
    linkForm.reset({
      groupId: String(item.groupId),
      url: item.url,
      name: item.name,
      avatar: item.avatar,
      description: item.description,
      backlinkUrl: item.backlinkUrl || '',
      colorKey: item.colorKey || 'sky',
      sortOrder: String(item.sortOrder ?? 0),
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
      if (data.url)
        linkForm.setValue('url', data.url, { shouldValidate: true })
      if (data.name)
        linkForm.setValue('name', data.name, { shouldValidate: true })
      if (data.avatar) {
        setImmediateDialogAvatar(data.avatar.trim())
        linkForm.setValue('avatar', data.avatar, { shouldValidate: true })
      }
      if (data.description)
        linkForm.setValue('description', data.description)
      if (data.colorKey)
        linkForm.setValue('colorKey', data.colorKey)
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
      backlinkUrl: values.backlinkUrl.trim(),
      colorKey: values.colorKey,
      sortOrder: Number(values.sortOrder) || 0,
      status: values.status,
      reviewNote: values.reviewNote.trim(),
    }
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
      await Promise.all([fetchLinks(), fetchGroups()])
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleQuickReview = async (item: FriendLinkAdmin, status: FriendStatus, reviewNote = '') => {
    try {
      await adminReviewFriendLink(item.id, { status, reviewNote })
      toast.success(t('review_updated'))
      await fetchLinks()
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
      await fetchLinks()
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const handleSingleProbe = async (id: number) => {
    setProbingId(id)
    try {
      const res = await adminProbeFriendLink(id)
      setLinks(prev => prev.map(item => (item.id === id ? res.data : item)))
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
      await fetchGroups()
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
      await fetchGroups()
    }
    catch (err) {
      toast.error(errorMessageT(err))
    }
  }

  const persistGroupOrder = async (next: FriendGroupAdmin[]) => {
    setGroups(next)
    setReordering(true)
    try {
      await adminReorderFriendGroups(next.map(item => item.id))
      toast.success(t('reorder_saved'))
      await fetchGroups()
    }
    catch (err) {
      toast.error(errorMessageT(err))
      await fetchGroups()
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

  const renderStatusBadge = (status: FriendStatus) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600">{friendT('status_approved')}</Badge>
      case 'pre_approved':
        return <Badge variant="secondary" className="text-amber-600 dark:text-amber-400">{friendT('status_pre_approved')}</Badge>
      case 'rejected':
        return <Badge variant="destructive">{friendT('status_rejected')}</Badge>
      default:
        return <Badge variant="outline">{friendT('status_pending')}</Badge>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        <div className="flex flex-wrap items-center gap-2">
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
          {mainTab === 'groups'
            ? (
                <Button type="button" size="sm" onClick={openCreateGroupDialog}>
                  <FolderPlusIcon className="size-4" />
                  {t('add_group')}
                </Button>
              )
            : (
                <Button type="button" size="sm" onClick={openCreateLinkDialog}>
                  <PlusIcon className="size-4" />
                  {t('add_link')}
                </Button>
              )}
        </div>
      </div>

      {/* 主视图切换：全部友链与审核 / 分组管理与排序联动 */}
      <Tabs value={mainTab} onValueChange={v => setMainTab(v as 'links' | 'groups')} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <TabsList variant="underline" className="w-full max-w-full min-w-0 justify-start">
          <TabsTrigger value="links" className="flex-none px-3">
            <span>{t('tab_links')}</span>
            {pendingReviewCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs tabular-nums">
                {pendingReviewCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex-none px-3">
            <span>{t('tab_groups')}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{groups.length}</span>
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
              className="max-w-full min-w-0"
            >
              <TabsList className="max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {t('sort_order_value', { order: item.sortOrder })}
                          </span>
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
                              <Button type="button" variant="ghost" size="icon" className="size-8">
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

        {/* Tab 2: 分组管理与前台顺序联动 */}
        <TabsContent value="groups" className="grid gap-4">
          <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {t('groups_order_hint')}
          </div>

          {groupsLoading && groups.length === 0
            ? (
                <div className="grid gap-2">
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
                  onReorder={next => void persistGroupOrder(next)}
                  renderItem={(group, idx, dragCtx) => (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] dark:shadow-none">
                      <SortableDragHandle
                        ctx={dragCtx}
                        disabled={groups.length <= 1 || reordering}
                        label={t('col_order')}
                        className="-ml-1"
                      />

                      <div className="min-w-0 basis-44 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-sm font-medium wrap-anywhere">
                            {presetT.groupName(group.presetKey, group.name)}
                          </span>
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {group.presetKey}
                          </Badge>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all text-muted-foreground">
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

                      <div className="ml-auto flex flex-wrap items-center gap-3">
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

                        <div className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={idx === 0 || reordering}
                            onClick={() => handleMoveGroup(idx, -1)}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
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
                  name="backlinkUrl"
                  render={({ field }) => (
                    <FormItem className="grid min-w-0 gap-2">
                      <FormLabel>{friendT('field_backlink_url')}</FormLabel>
                      <FormControl>
                        <Input {...field} type="text" inputMode="url" maxLength={512} placeholder="https://example.com/links" />
                      </FormControl>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={linkForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel>{t('field_status')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
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

                <FormField
                  control={linkForm.control}
                  name="sortOrder"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel>{t('field_sort_order')}</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
          await Promise.all([fetchLinks(), fetchGroups()])
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
          await fetchGroups()
        }}
      />
    </div>
  )
}
