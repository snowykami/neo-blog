'use client'

import type { SearchSelectOption } from './shared'
import type { AgentRunActionFilter, AgentRunStatus, AgentRunTrigger } from '@/models/ai-agent'
import { RefreshCw } from 'lucide-react'
import { parseAsInteger, parseAsStringEnum, useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { getAIAgent, listAIAgents } from '@/api/ai-agent'
import { UserAvatar } from '@/components/common/avatar'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AGENT_RUN_ACTION_FILTERS, AGENT_RUN_STATUSES, AGENT_RUN_TRIGGERS } from '@/models/ai-agent'
import { AgentRunList } from './run-list'
import { SearchSelect, triggerKey, useAIAgentT } from './shared'

const ALL = 'all'
const PAGE_SIZE = 20

// 搜索 AI 用户，作为下拉选项
export function useAgentSearch() {
  return useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const res = await listAIAgents({ page: 1, size: 20, query })
    return (res.data.agents ?? []).map(agent => ({
      value: agent.id,
      label: agent.user.nickname || agent.user.username,
      description: `@${agent.user.username}`,
      icon: <UserAvatar user={agent.user} size={48} className="size-5" fallbackClassName="text-[10px]" />,
    }))
  }, [])
}

// 行为日志：全部 AI 用户的运行记录，筛选条件写入地址参数
export function AgentRunsPage() {
  const t = useAIAgentT()
  const searchAgents = useAgentSearch()
  const options = { history: 'replace', clearOnDefault: true } as const
  const [agentId, setAgentId] = useQueryState('agent_id', parseAsInteger.withOptions(options))
  const [status, setStatus] = useQueryState('status', parseAsStringEnum<AgentRunStatus>([...AGENT_RUN_STATUSES]).withOptions(options))
  const [action, setAction] = useQueryState('action', parseAsStringEnum<AgentRunActionFilter>([...AGENT_RUN_ACTION_FILTERS]).withOptions(options))
  const [trigger, setTrigger] = useQueryState('trigger', parseAsStringEnum<AgentRunTrigger>([...AGENT_RUN_TRIGGERS]).withOptions(options))
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions(options))
  const [size, setSize] = useQueryState('size', parseAsInteger.withDefault(PAGE_SIZE).withOptions(options))
  const [agent, setAgent] = useState<SearchSelectOption | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // 从地址参数进入时补全选中的 AI 用户名称
  useEffect(() => {
    if (!agentId) {
      setAgent(null)
      return
    }
    if (agent?.value === agentId)
      return
    getAIAgent(agentId)
      .then(res => setAgent({
        value: res.data.id,
        label: res.data.user.nickname || res.data.user.username,
        icon: <UserAvatar user={res.data.user} size={48} className="size-5" fallbackClassName="text-[10px]" />,
      }))
      .catch(() => setAgent({ value: agentId, label: `#${agentId}` }))
  }, [agent?.value, agentId])

  const filterSelect = <T extends string>(value: T | null, onChange: (value: T | null) => void, items: readonly T[], label: string, allLabel: string, itemLabel: (item: T) => string) => (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => {
        onChange(v === ALL ? null : v as T)
        setPage(1)
      }}
    >
      <SelectTrigger className="w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {items.map(item => <SelectItem key={item} value={item}>{itemLabel(item)}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchSelect
            className="w-56"
            selected={agent}
            placeholder={t('runs.all_agents')}
            emptyText={t('list.empty')}
            search={searchAgents}
            onSelect={(option) => {
              setAgent(option)
              setAgentId(option?.value ?? null)
              setPage(1)
            }}
          />
          {filterSelect(status, setStatus, AGENT_RUN_STATUSES, t('runs.filter_status'), t('runs.all_status'), item => t(`run_status.${item}`))}
          {filterSelect(action, setAction, AGENT_RUN_ACTION_FILTERS, t('runs.filter_action'), t('runs.all_actions'), item => t(`action_filter.${item}`))}
          {filterSelect(trigger, setTrigger, AGENT_RUN_TRIGGERS, t('runs.filter_trigger'), t('runs.all_triggers'), item => t(`trigger.${triggerKey(item)}`))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setRefreshKey(k => k + 1)}>
          <RefreshCw />
          {t('refresh')}
        </Button>
      </div>
      <AgentRunList
        filters={{ agentId: agentId ?? undefined, status: status ?? '', action: action ?? '', trigger: trigger ?? '' }}
        page={page}
        size={size}
        refreshKey={refreshKey}
        onPageChange={setPage}
        onSizeChange={(next) => {
          setSize(next)
          setPage(1)
        }}
      />
    </div>
  )
}
