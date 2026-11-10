'use client'

import type { MemorySubject } from './memories-panel'
import type { AIAgent } from '@/models/ai-agent'
import { BotOff, ChevronLeft, Download, ListTree, Pause, Play, UserPen } from 'lucide-react'
import { useFormatter } from 'next-intl'
import { useParams } from 'next/navigation'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteAIAgent, getAIAgent, pauseAIAgent, resumeAIAgent } from '@/api/ai-agent'
import { EditUserDialog } from '@/app/[locale]/console/users/user-dialogs'
import { UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link, useRouter } from '@/i18n/navigation'
import { consolePath } from '@/utils/common/route'
import { useExportAIAgents } from './agent-file'
import { DryRunCard } from './dry-run-card'
import { AgentMemoriesPanel } from './memories-panel'
import { AgentProfileForm } from './profile-form'
import { AgentRelationsPanel } from './relations-panel'
import { AgentRunList } from './run-list'
import { AgentStatusBadge, TierBadge, useAIAgentT, useCompactNumber } from './shared'

const TABS = ['profile', 'memories', 'relations', 'runs'] as const
type Tab = (typeof TABS)[number]

// 单个 AI 用户：性格设置、试运行、记忆、关系与运行记录
export function AIAgentDetailPage() {
  const t = useAIAgentT()
  const { id } = useParams() as { id: string }
  const agentId = Number(id)
  const errorMessageT = useErrorMessageT()
  const [agent, setAgent] = useState<AIAgent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useQueryState('tab', parseAsStringEnum<Tab>([...TABS]).withDefault('profile').withOptions({ history: 'replace', clearOnDefault: true }))
  const [subject, setSubject] = useState<MemorySubject | null>(null)
  const [runPage, setRunPage] = useState(1)
  const [runSize, setRunSize] = useState(20)

  const fetchAgent = useCallback(async () => {
    setError(null)
    try {
      const res = await getAIAgent(agentId)
      setAgent(res.data)
    }
    catch (err) {
      setError(errorMessageT(err, t('detail.not_found')))
    }
  }, [agentId, errorMessageT, t])

  useEffect(() => {
    fetchAgent()
  }, [fetchAgent])

  return (
    <div className="grid gap-4">
      <Link href={consolePath.aiAgent} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {t('detail.back')}
      </Link>
      {!agent && !error && <Skeleton className="h-32 w-full" />}
      {error && <p role="alert" className="py-8 text-center text-muted-foreground">{error}</p>}
      {agent && (
        <>
          <AgentHeader agent={agent} onChanged={setAgent} onReload={fetchAgent} />
          <Tabs value={tab} onValueChange={v => void setTab(v as Tab)} className="gap-4">
            <TabsList variant="underline" className="w-full justify-start">
              {TABS.map(item => <TabsTrigger key={item} value={item} className="flex-none px-3">{t(`detail.tab_${item}`)}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="profile">
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
                <AgentProfileForm key={agent.id} agent={agent} onSaved={setAgent} />
                <div className="lg:sticky lg:top-4">
                  <DryRunCard agentId={agent.id} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="memories">
              <AgentMemoriesPanel agentId={agent.id} subject={subject} onSubjectChange={setSubject} />
            </TabsContent>
            <TabsContent value="relations">
              <AgentRelationsPanel
                agentId={agent.id}
                onViewMemories={(next) => {
                  setSubject(next)
                  setTab('memories')
                }}
              />
            </TabsContent>
            <TabsContent value="runs">
              <AgentRunList
                filters={{ agentId: agent.id }}
                showAgent={false}
                page={runPage}
                size={runSize}
                onPageChange={setRunPage}
                onSizeChange={(next) => {
                  setRunSize(next)
                  setRunPage(1)
                }}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

function AgentHeader({ agent, onChanged, onReload }: { agent: AIAgent, onChanged: (agent: AIAgent) => void, onReload: () => void }) {
  const t = useAIAgentT()
  const router = useRouter()
  const format = useFormatter()
  const compact = useCompactNumber()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [toggling, setToggling] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const { exporting, exportAgents } = useExportAIAgents()
  const name = agent.user.nickname || agent.user.username

  const toggle = async () => {
    setToggling(true)
    try {
      if (agent.status === 'active')
        await pauseAIAgent(agent.id)
      else
        await resumeAIAgent(agent.id)
      onChanged({ ...agent, status: agent.status === 'active' ? 'paused' : 'active', pausedReason: '' })
      toast.success(operationT('update_success'))
    }
    catch (err) {
      toast.error(errorMessageT(err, operationT('update_failed')))
    }
    finally {
      setToggling(false)
    }
  }

  const handleRemove = async () => {
    await deleteAIAgent(agent.id)
    toast.success(t('detail.remove_success'))
    router.push(consolePath.aiAgent)
  }

  return (
    <Card className="py-4">
      <CardContent className="grid gap-4 px-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar user={agent.user} size={128} className="size-14" fallbackClassName="text-lg" />
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-lg font-semibold">{name}</span>
                <TierBadge tier={agent.tier} />
                <AgentStatusBadge status={agent.status} reason={agent.pausedReason} />
                {agent.groupName && <Badge variant="outline">{agent.groupName}</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{`@${agent.user.username}`}</span>
                <span>{t('detail.created_at', { time: format.dateTime(new Date(agent.createdAt), { dateStyle: 'medium' }) })}</span>
                <span>
                  {agent.lastActiveAt
                    ? t('detail.last_active', { time: format.relativeTime(new Date(agent.lastActiveAt)) })
                    : t('list.never_active')}
                </span>
                <span className="tabular-nums">{t('list.today_value', { comments: agent.todayComments, likes: agent.todayLikes })}</span>
                <span className="tabular-nums">{t('detail.month_tokens', { value: compact(agent.monthTokens) })}</span>
              </div>
              {agent.status === 'paused' && agent.pausedReason && (
                <span className="text-xs text-muted-foreground">{t('detail.paused_reason', { reason: agent.pausedReason })}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={toggling} onClick={toggle}>
              {agent.status === 'active' ? <Pause /> : <Play />}
              {agent.status === 'active' ? t('pause') : t('resume')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <UserPen />
              {t('detail.edit_account')}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`${consolePath.aiAgentRun}?agent_id=${agent.id}`}>
                <ListTree />
                {t('list.logs')}
              </Link>
            </Button>
            <Button size="sm" variant="outline" disabled={exporting} title={t('detail.export_hint')} onClick={() => exportAgents({ id: agent.id })}>
              <Download />
              {t('detail.export')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setRemoveOpen(true)}>
              <BotOff />
              {t('detail.remove')}
            </Button>
          </div>
        </div>
        <div className="grid gap-1 rounded-md border bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">{t('detail.self_summary')}</span>
          <p className="text-sm whitespace-pre-wrap">{agent.selfSummary || t('detail.self_summary_empty')}</p>
        </div>
      </CardContent>
      {/* 昵称、头像等账号资料沿用用户管理的编辑表单 */}
      <EditUserDialog
        user={editOpen ? agent.user : null}
        onOpenChange={open => !open && setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          onReload()
        }}
      />
      {removeOpen && (
        <ConfirmDialog
          open
          title={t('detail.remove_title', { name })}
          description={(
            <>
              <p>{t('detail.remove_description')}</p>
              <p className="font-medium text-destructive">{t('detail.remove_irreversible')}</p>
            </>
          )}
          confirmLabel={t('detail.remove')}
          errorText={operationT('operation_failed')}
          onOpenChange={setRemoveOpen}
          onConfirm={handleRemove}
        />
      )}
    </Card>
  )
}
