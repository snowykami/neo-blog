'use client'

import type { AIAgent, AIAgentStats, AIAgentStatus, AIAgentTier } from '@/models/ai-agent'
import { Download, ListTree, Plus, SlidersHorizontal, Upload, Wand, X } from 'lucide-react'
import { useFormatter } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { parseAsInteger, parseAsString, parseAsStringEnum, useQueryState } from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAIAgentStats, listAIAgentGroups, listAIAgents, pauseAIAgent, resumeAIAgent } from '@/api/ai-agent'
import { UserAvatar } from '@/components/common/avatar'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { AI_AGENT_STATUSES, AI_AGENT_TIERS } from '@/models/ai-agent'
import { consolePath } from '@/utils/common/route'
import { useExportAIAgents } from './agent-file'
import { CreateAgentDialog } from './create-agent-dialog'
import { GenerateGroupDialog } from './generate-group-dialog'
import { AIAgentGroupsPanel } from './groups-card'
import { ImportAgentsDialog } from './import-agents-dialog'
import { AgentStatusBadge, TierBadge, useAIAgentT, useCompactNumber } from './shared'
import { AIAgentStatsCards } from './stats-cards'

const ALL = 'all'
const PAGE_SIZE = 15
const COLUMN_COUNT = 7
const VIEWS = ['agents', 'groups'] as const
type View = (typeof VIEWS)[number]

// AI 用户管理：总览统计、AI 用户列表与群体（权限由控制台布局与后端 admin 中间件校验）
export function AIAgentsPage() {
  const t = useAIAgentT()
  const router = useRouter()
  const format = useFormatter()
  const compact = useCompactNumber()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const options = { history: 'replace', clearOnDefault: true } as const
  const [view, setView] = useQueryState('view', parseAsStringEnum<View>([...VIEWS]).withDefault('agents').withOptions(options))
  const [query, setQuery] = useQueryState('query', parseAsString.withDefault('').withOptions(options))
  const [tier, setTier] = useQueryState('tier', parseAsStringEnum<AIAgentTier>([...AI_AGENT_TIERS]).withOptions(options))
  const [status, setStatus] = useQueryState('status', parseAsStringEnum<AIAgentStatus>([...AI_AGENT_STATUSES]).withOptions(options))
  const [groupId, setGroupId] = useQueryState('group_id', parseAsInteger.withOptions(options))
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions(options))
  const [size, setSize] = useQueryState('size', parseAsInteger.withDefault(PAGE_SIZE).withOptions(options))
  const [queryInput, setQueryInput, debouncedQuery] = useDebouncedState(query, 300)
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<AIAgentStats | null>(null)
  const [groups, setGroups] = useState<{ id: number, name: string }[]>([])
  const [groupsRefreshKey, setGroupsRefreshKey] = useState(0)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const { exporting, exportAgents } = useExportAIAgents()

  const fetchStats = useCallback(() => {
    getAIAgentStats().then(res => setStats(res.data)).catch(() => {})
  }, [])

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listAIAgents({ page, size, query: query.trim(), tier: tier ?? '', status: status ?? '', groupId: groupId ?? undefined })
      setAgents(res.data.agents ?? [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [errorMessageT, groupId, page, query, size, status, tier])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // 群体筛选项
  useEffect(() => {
    listAIAgentGroups().then(res => setGroups((res.data.groups ?? []).map(({ id, name }) => ({ id, name })))).catch(() => {})
  }, [groupsRefreshKey])

  // 搜索词防抖后写入地址参数；仅在真正变化时回到第一页
  const prevQueryRef = useRef(debouncedQuery)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQuery)
      return
    prevQueryRef.current = debouncedQuery
    setQuery(debouncedQuery)
    setPage(1)
  }, [debouncedQuery, setPage, setQuery])

  const refreshAll = useCallback(() => {
    fetchAgents()
    fetchStats()
  }, [fetchAgents, fetchStats])

  const toggleAgent = async (agent: AIAgent) => {
    setTogglingId(agent.id)
    try {
      if (agent.status === 'active')
        await pauseAIAgent(agent.id)
      else
        await resumeAIAgent(agent.id)
      const next: AIAgentStatus = agent.status === 'active' ? 'paused' : 'active'
      setAgents(list => list.map(item => (item.id === agent.id ? { ...item, status: next, pausedReason: '' } : item)))
      toast.success(operationT('update_success'))
      fetchStats()
    }
    catch (err) {
      toast.error(errorMessageT(err, operationT('update_failed')))
    }
    finally {
      setTogglingId(null)
    }
  }

  const filterSelect = <T extends string>(value: T | null, onChange: (value: T | null) => void, items: readonly { value: T, label: string }[], label: string, allLabel: string) => (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => {
        onChange(v === ALL ? null : v as T)
        setPage(1)
      }}
    >
      <SelectTrigger className="w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  const groupName = groups.find(group => group.id === groupId)?.name

  return (
    <div className="grid gap-4">
      <AIAgentStatsCards stats={stats} />

      <Tabs value={view} onValueChange={v => void setView(v as View)} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="agents">
              {t('list.tab_agents')}
              {stats && <span className="text-xs text-muted-foreground tabular-nums">{stats.total}</span>}
            </TabsTrigger>
            <TabsTrigger value="groups">
              {t('list.tab_groups')}
              {stats && <span className="text-xs text-muted-foreground tabular-nums">{stats.groups}</span>}
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload />
              {t('list.import')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={exporting}
              title={t('list.export_hint')}
              onClick={() => exportAgents({ query: query.trim(), tier: tier ?? '', status: status ?? '', groupId: groupId ?? undefined })}
            >
              <Download />
              {t('list.export')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
              <Wand />
              {t('list.generate')}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('list.create')}
            </Button>
          </div>
        </div>

        <TabsContent value="agents" className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="w-full sm:w-64"
              type="search"
              placeholder={t('list.search_placeholder')}
              aria-label={t('list.search_placeholder')}
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
            />
            {filterSelect(tier, setTier, AI_AGENT_TIERS.map(item => ({ value: item, label: t(`tier.${item}`) })), t('tier_label'), t('list.all_tiers'))}
            {filterSelect(status, setStatus, AI_AGENT_STATUSES.map(item => ({ value: item, label: t(`status.${item}`) })), t('list.col_status'), t('list.all_status'))}
            <Select
              value={groupId ? String(groupId) : ALL}
              onValueChange={(v) => {
                setGroupId(v === ALL ? null : Number(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44" aria-label={t('list.filter_group')}>
                <SelectValue>{groupId ? (groupName ?? `#${groupId}`) : t('list.all_groups')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('list.all_groups')}</SelectItem>
                {groups.map(group => <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {(query || tier || status || groupId) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQueryInput('')
                  setQuery(null)
                  setTier(null)
                  setStatus(null)
                  setGroupId(null)
                  setPage(1)
                }}
              >
                <X />
                {t('list.clear_filters')}
              </Button>
            )}
          </div>
          <div className="text-sm text-muted-foreground tabular-nums">{t('list.total', { total })}</div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.col_agent')}</TableHead>
                  <TableHead>{t('tier_label')}</TableHead>
                  <TableHead>{t('list.col_status')}</TableHead>
                  <TableHead>{t('list.col_today')}</TableHead>
                  <TableHead>{t('list.col_month_tokens')}</TableHead>
                  <TableHead>{t('list.col_last_active')}</TableHead>
                  <TableHead className="text-right">{t('list.col_actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <Skeleton className="h-4 w-28" />
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-32" /></TableCell>
                  </TableRow>
                ))}
                {!loading && error && (
                  <TableRow>
                    <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center">
                      <div className="grid justify-items-center gap-3">
                        <p role="alert" className="text-sm text-destructive">{`${t('list.load_failed')}: ${error}`}</p>
                        <Button size="sm" variant="outline" onClick={fetchAgents}>{t('retry')}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && !error && agents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">{t('list.empty')}</TableCell>
                  </TableRow>
                )}
                {!loading && !error && agents.map(agent => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <Link href={`${consolePath.aiAgent}/${agent.id}`} className="flex items-center gap-3">
                        <UserAvatar user={agent.user} size={64} className="size-8" fallbackClassName="text-xs" />
                        <div className="grid min-w-0">
                          <span className="truncate font-medium hover:underline">{agent.user.nickname || agent.user.username}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {`@${agent.user.username}`}
                            {agent.profile.archetype && ` · ${agent.profile.archetype}`}
                          </span>
                        </div>
                        {agent.groupName && <Badge variant="outline" className="max-w-32 truncate">{agent.groupName}</Badge>}
                      </Link>
                    </TableCell>
                    <TableCell><TierBadge tier={agent.tier} /></TableCell>
                    <TableCell><AgentStatusBadge status={agent.status} reason={agent.pausedReason} /></TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {t('list.today_value', { comments: agent.todayComments, likes: agent.todayLikes })}
                    </TableCell>
                    <TableCell className="tabular-nums">{compact(agent.monthTokens)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {agent.lastActiveAt
                        ? (
                            <time dateTime={agent.lastActiveAt} title={format.dateTime(new Date(agent.lastActiveAt), { dateStyle: 'medium', timeStyle: 'short' })}>
                              {format.relativeTime(new Date(agent.lastActiveAt))}
                            </time>
                          )
                        : t('list.never_active')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`${consolePath.aiAgent}/${agent.id}`}>
                            <SlidersHorizontal />
                            {t('list.edit')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`${consolePath.aiAgentRun}?agent_id=${agent.id}`}>
                            <ListTree />
                            {t('list.logs')}
                          </Link>
                        </Button>
                        <Switch
                          checked={agent.status === 'active'}
                          disabled={togglingId === agent.id}
                          aria-label={agent.status === 'active' ? t('pause') : t('resume')}
                          title={agent.status === 'active' ? t('pause') : t('resume')}
                          onCheckedChange={() => toggleAgent(agent)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {total > 0 && <PaginationController page={page} onPageChange={setPage} total={total} pageSize={size} />}
            <PageSizeSelector
              size={size}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="groups">
          <AIAgentGroupsPanel
            refreshKey={groupsRefreshKey}
            onChanged={refreshAll}
            onViewMembers={(group) => {
              setGroupId(group.id)
              setPage(1)
              setView('agents')
            }}
          />
        </TabsContent>
      </Tabs>

      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(agent) => {
          setCreateOpen(false)
          // 创建后直接进入性格设置
          router.push(`${consolePath.aiAgent}/${agent.id}`)
        }}
      />
      <ImportAgentsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(agentIds, done) => {
          refreshAll()
          if (!done)
            return
          setImportOpen(false)
          // 只导入了一个时直接进入详情页，便于试运行与调整
          if (agentIds.length === 1)
            router.push(`${consolePath.aiAgent}/${agentIds[0]}`)
        }}
      />
      <GenerateGroupDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerated={() => {
          setGenerateOpen(false)
          setGroupsRefreshKey(k => k + 1)
          setView('groups')
          fetchStats()
        }}
      />
    </div>
  )
}
