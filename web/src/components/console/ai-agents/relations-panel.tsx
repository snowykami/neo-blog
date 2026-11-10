'use client'

import type { MemorySubject } from './memories-panel'
import type { AgentRelation } from '@/models/ai-agent'
import { Brain, Sparkles, Trash2 } from 'lucide-react'
import { useFormatter } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteAgentRelation, listAgentRelations } from '@/api/ai-agent'
import { UserAvatar } from '@/components/common/avatar'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { getUserUrl } from '@/utils/common/route'
import { useAIAgentT } from './shared'

const COLUMN_COUNT = 6

// 关系：AI 对每个人的熟悉度、印象与聊过的话题
export function AgentRelationsPanel({ agentId, onViewMemories }: {
  agentId: number
  onViewMemories: (subject: MemorySubject) => void
}) {
  const t = useAIAgentT()
  const format = useFormatter()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [relations, setRelations] = useState<AgentRelation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRelations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listAgentRelations(agentId, { page, size })
      setRelations(res.data.relations ?? [])
      setTotal(res.data.total)
    }
    catch (err) {
      setError(errorMessageT(err))
    }
    finally {
      setLoading(false)
    }
  }, [agentId, errorMessageT, page, size])

  useEffect(() => {
    fetchRelations()
  }, [fetchRelations])

  const handleDelete = async (relation: AgentRelation) => {
    await deleteAgentRelation(relation.id)
    toast.success(operationT('delete_success'))
    if (relations.length <= 1 && page > 1)
      setPage(page - 1)
    else
      await fetchRelations()
  }

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('relations.col_user')}</TableHead>
              <TableHead className="w-36">{t('relations.col_familiarity')}</TableHead>
              <TableHead>{t('relations.col_impression')}</TableHead>
              <TableHead className="w-24">{t('relations.col_interactions')}</TableHead>
              <TableHead className="w-28">{t('relations.col_last')}</TableHead>
              <TableHead className="w-28 text-right">{t('list.col_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 4 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell colSpan={COLUMN_COUNT}><Skeleton className="h-6 w-full" /></TableCell>
              </TableRow>
            ))}
            {!loading && error && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center">
                  <div className="grid justify-items-center gap-3">
                    <p role="alert" className="text-sm text-destructive">{`${t('relations.load_failed')}: ${error}`}</p>
                    <Button size="sm" variant="outline" onClick={fetchRelations}>{t('retry')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && relations.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">{t('relations.empty')}</TableCell>
              </TableRow>
            )}
            {!loading && !error && relations.map((relation) => {
              const name = relation.user.nickname || relation.user.username
              return (
                <TableRow key={relation.id}>
                  <TableCell className="align-top">
                    <Link href={getUserUrl(relation.user)} target="_blank" className="flex items-center gap-2 hover:text-primary">
                      <UserAvatar user={relation.user} size={48} className="size-7" fallbackClassName="text-xs" />
                      <div className="grid min-w-0">
                        <span className="truncate font-medium">{name}</span>
                        <span className="truncate text-xs text-muted-foreground">{`@${relation.user.username}`}</span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="grid gap-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="tabular-nums">{relation.familiarity.toFixed(2)}</span>
                        {relation.milestoneAt && (
                          <Badge variant="secondary" title={format.dateTime(new Date(relation.milestoneAt), { dateStyle: 'medium' })}>
                            <Sparkles />
                            {t('relations.acquainted')}
                          </Badge>
                        )}
                      </div>
                      <Progress value={Math.min(100, Math.max(0, relation.familiarity * 100))} className="h-1.5" />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md align-top whitespace-normal">
                    <div className="grid gap-1">
                      <span className="break-words">{relation.impression || '-'}</span>
                      {(relation.topics ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(relation.topics ?? []).map(topic => <Badge key={topic} variant="outline">{topic}</Badge>)}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top tabular-nums">{relation.interactions}</TableCell>
                  <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                    {relation.lastInteractedAt ? format.relativeTime(new Date(relation.lastInteractedAt)) : '-'}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t('relations.view_memories')}
                        title={t('relations.view_memories')}
                        onClick={() => onViewMemories({ id: relation.user.id, name })}
                      >
                        <Brain className="size-4" />
                      </Button>
                      <Popconfirm
                        title={t('relations.delete_title', { name })}
                        description={t('relations.delete_description')}
                        confirmText={operationT('delete')}
                        errorText={operationT('delete_failed')}
                        destructive
                        onConfirm={() => handleDelete(relation)}
                      >
                        <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={operationT('delete')} title={operationT('delete')}>
                          <Trash2 className="size-4" />
                        </Button>
                      </Popconfirm>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
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
    </div>
  )
}
