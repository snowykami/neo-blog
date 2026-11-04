'use client'

import type { AIAgentGroup } from '@/models/ai-agent'
import { Pause, Play, Users } from 'lucide-react'
import { useFormatter } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listAIAgentGroups, updateAIAgentGroupStatus } from '@/api/ai-agent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { TierBadge, useAIAgentT } from './shared'

const POLL_INTERVAL = 3000

// 群体列表：生成中的群体轮询进度，可整组暂停 / 恢复，点击查看成员
export function AIAgentGroupsPanel({ refreshKey, onViewMembers, onChanged }: {
  refreshKey: number
  onViewMembers: (group: AIAgentGroup) => void
  onChanged: () => void // 生成完成或整组暂停 / 恢复后刷新 AI 用户列表与统计
}) {
  const t = useAIAgentT()
  const format = useFormatter()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [groups, setGroups] = useState<AIAgentGroup[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const generatingRef = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listAIAgentGroups()
      const list = res.data.groups ?? []
      setGroups(list)
      const generating = list.some(group => group.status === 'generating')
      // 生成结束时通知外层刷新
      if (generatingRef.current && !generating)
        onChangedRef.current()
      generatingRef.current = generating
    }
    catch {
      setGroups(list => list ?? [])
    }
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups, refreshKey])

  const hasGenerating = groups?.some(group => group.status === 'generating') ?? false
  useEffect(() => {
    if (!hasGenerating)
      return
    const timer = window.setInterval(fetchGroups, POLL_INTERVAL)
    return () => window.clearInterval(timer)
  }, [fetchGroups, hasGenerating])

  const setStatus = async (group: AIAgentGroup, status: 'active' | 'paused') => {
    setBusyId(group.id)
    try {
      await updateAIAgentGroupStatus(group.id, status)
      toast.success(operationT('update_success'))
      await fetchGroups()
      onChanged()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('update_failed')))
    }
    finally {
      setBusyId(null)
    }
  }

  if (!groups)
    return <Skeleton className="h-32 w-full" />

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('groups.name')}</TableHead>
            <TableHead>{t('tier_label')}</TableHead>
            <TableHead>{t('groups.members')}</TableHead>
            <TableHead className="min-w-48">{t('groups.progress')}</TableHead>
            <TableHead>{t('groups.created_at')}</TableHead>
            <TableHead className="text-right">{t('list.col_actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('groups.empty')}</TableCell>
            </TableRow>
          )}
          {groups.map((group) => {
            const percent = group.total > 0 ? Math.min(100, (group.created / group.total) * 100) : 0
            return (
              <TableRow key={group.id}>
                <TableCell>
                  <div className="grid gap-0.5">
                    <span className="font-medium">{group.name}</span>
                    {group.template.archetypes?.length > 0 && (
                      <span className="max-w-64 truncate text-xs text-muted-foreground">
                        {group.template.archetypes.map(item => item.name).join(' / ')}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell><TierBadge tier={group.template.tier} /></TableCell>
                <TableCell className="tabular-nums">
                  {t('groups.members_value', { total: group.agentCount, active: group.activeCount })}
                </TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant={group.status === 'failed' ? 'destructive' : group.status === 'done' ? 'outline' : 'secondary'}>
                        {t(`groups.status.${group.status}`)}
                      </Badge>
                      <span className="text-muted-foreground tabular-nums">{`${group.created} / ${group.total}`}</span>
                    </div>
                    {group.status === 'generating' && <Progress value={percent} className="h-1.5" />}
                    {group.error && <span className="text-xs text-destructive">{group.error}</span>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {format.dateTime(new Date(group.createdAt), { dateStyle: 'medium' })}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onViewMembers(group)}>
                      <Users />
                      {t('groups.view_members')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === group.id || group.activeCount === 0}
                      onClick={() => setStatus(group, 'paused')}
                    >
                      <Pause />
                      {t('groups.pause_all')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === group.id || group.activeCount >= group.agentCount}
                      onClick={() => setStatus(group, 'active')}
                    >
                      <Play />
                      {t('groups.resume_all')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
