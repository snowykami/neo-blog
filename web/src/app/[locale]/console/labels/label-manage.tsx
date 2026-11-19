'use client'

import type { Label } from '@/models/label'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteLabel, getLabels } from '@/api/label'
import { DeleteButtonWithPopconfirm } from '@/components/common/delete-button-with-popconfirm'
import { CreateOrUpdateLabelDialogWithButton } from '@/components/console/common/create-label-and-category'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/contexts/auth-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { isAdmin } from '@/utils/common/permission'

export function LabelManage() {
  const t = useTranslations('Console.labels')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const { user } = useAuth()
  // 标签全站共享：编辑者只能新建，改名与删除只有管理员可以（与后端路由一致）
  const canManage = !!user && isAdmin({ user })

  const [query, setQuery] = useState('')
  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const labelsQuery = useConsoleQuery(
    ['label/list'],
    () => getLabels().then(res => res.data.labels || []),
    { onError: () => toast.error(operationT('fetch_failed')) },
  )
  const labels = labelsQuery.data ?? []
  const loading = labelsQuery.loading && !labelsQuery.data

  const onChange = () => {
    void labelsQuery.refresh()
  }

  const filtered = labels.filter(
    l =>
      l.name.toLowerCase().includes(query.toLowerCase())
      || l.slug.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder={t('search_labels')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1"
        />
        <CreateOrUpdateLabelDialogWithButton label={null} onLabelCreated={onChange} />
      </div>
      {!canManage && <p className="text-sm text-muted-foreground mb-4">{t('admin_only_hint')}</p>}

      {loading && (
        <div
          className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={commonT('loading')}
        >
          {Array.from({ length: 6 }, (_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <Empty className="rounded-xl border bg-card py-10">
          <EmptyDescription>{t('no_labels')}</EmptyDescription>
        </Empty>
      )}
      {!loading && filtered.length > 0 && (
        <div className="overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map(l => (
            <LabelItem key={l.id} label={l} canManage={canManage} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}

function LabelItem({ label, canManage, onChange }: { label: Label, canManage: boolean, onChange: () => void }) {
  const operationT = useOperationT()
  const handleDelete = async () => {
    await deleteLabel({ id: label.id })
    toast.success(operationT('delete_success'))
    onChange()
  }
  return (
    <div
      key={label.id}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card transition-colors hover:border-primary/40"
    >
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        <div className="">
          <span className="text-sm font-medium flex-shrink-0">{label.name}</span>
          <div className="text-sm text-muted-foreground truncate min-w-0">
            {label.slug}
          </div>
        </div>
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          <CreateOrUpdateLabelDialogWithButton
            label={label}
            onLabelCreated={onChange}
          />
          <DeleteButtonWithPopconfirm name={label.name} onDelete={handleDelete} />
        </div>
      )}
    </div>
  )
}
