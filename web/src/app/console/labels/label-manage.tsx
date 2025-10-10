'use client'

import type { Label } from '@/models/label'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteLabel, getLabels } from '@/api/label'
import { DeleteButtonWithConfirmDialog } from '@/components/common/delete-button-with-confirm-dialog'
import { CreateOrUpdateLabelDialogWithButton } from '@/components/console/common/create-label-and-category'
import { Input } from '@/components/ui/input'
import { useOperationT } from '@/hooks/use-translations'

export function LabelManage() {
  const t = useTranslations('Console.labels')
  const operationT = useOperationT()

  const [labels, setLabels] = useState<Label[]>([])
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    getLabels()
      .then(res => setLabels(res.data.labels || []))
      .catch(() => toast.error(operationT('fetch_failed')))
  }, [operationT, refreshKey])

  const onChange = () => {
    setRefreshKey(k => k + 1)
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
  const handleDelete = () => {
    deleteLabel({ id: label.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onChange()
      })
      .catch(() => toast.error(operationT('delete_failed')))
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
        <DeleteButtonWithConfirmDialog onDelete={handleDelete} />
      </div>
    </div>
  )
}
