'use client'

import type { Label } from '@/models/label'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteLabel, getLabels } from '@/api/label'
import { DeleteButtonWithPopconfirm } from '@/components/common/delete-button-with-popconfirm'
import { CreateOrUpdateLabelDialogWithButton } from '@/components/console/common/create-label-and-category'
import { Input } from '@/components/ui/input'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useOperationT } from '@/hooks/use-translations'

export function LabelManage() {
  const t = useTranslations('Console.labels')
  const operationT = useOperationT()

  const [query, setQuery] = useState('')
  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const labelsQuery = useConsoleQuery(
    ['label/list'],
    () => getLabels().then(res => res.data.labels || []),
    { onError: () => toast.error(operationT('fetch_failed')) },
  )
  const labels = labelsQuery.data ?? []

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

      <div className="overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map(l => (
          <LabelItem key={l.id} label={l} onChange={onChange} />
        ))}
      </div>
    </div>
  )
}

function LabelItem({ label, onChange }: { label: Label, onChange: () => void }) {
  const operationT = useOperationT()
  const handleDelete = async () => {
    await deleteLabel({ id: label.id })
    toast.success(operationT('delete_success'))
    onChange()
  }
  return (
    <div
      key={label.id}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900"
    >
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        <div className="">
          <span className="text-sm font-medium flex-shrink-0">{label.name}</span>
          <div className="text-sm text-muted-foreground truncate min-w-0">
            {label.slug}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <CreateOrUpdateLabelDialogWithButton
          label={label}
          onLabelCreated={onChange}
        />
        <DeleteButtonWithPopconfirm name={label.name} onDelete={handleDelete} />
      </div>
    </div>
  )
}
