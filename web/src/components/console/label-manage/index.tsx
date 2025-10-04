"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Trash } from "lucide-react"
import { getLabels, deleteLabel } from "@/api/label"
import type { Label } from "@/models/label"
import { CreateOrUpdateLabelDialogWithButton } from "../common/create-label-and-category"
import { ConfirmDialog } from "@/components/common/confirm-dialog"

export function LabelManage() {
  const t = useTranslations("Console.labels")
  const operationT = useTranslations("Operation")

  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    setLoading(true)
    getLabels()
      .then(res => setLabels(res.data.labels || []))
      .catch(() => toast.error(operationT("fetch_failed")))
      .finally(() => setLoading(false))
  }, [operationT])

  const handleDelete = async (id: number) => {
    deleteLabel({ id })
      .then(() => {
        setLabels(prev => prev.filter(l => l.id !== id))
        toast.success(operationT("delete_success"))
      })
      .catch(() => toast.error(operationT("delete_failed")))
  }

  const onLabelCreated = (label: Label) => {
    setLabels(prev => {
      const exist = prev.find(l => l.id === label.id)
      if (exist) {
        return prev.map(l => l.id === label.id ? label : l)
      } else {
        return [label, ...prev]
      }
    })
  }

  const filtered = labels.filter(l => l.name.toLowerCase().includes(query.toLowerCase()) || l.slug.toLowerCase().includes(query.toLowerCase()))

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input placeholder={t("search_labels")} value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        <CreateOrUpdateLabelDialogWithButton label={null} onLabelCreated={onLabelCreated} />
      </div>

      <div className="max-h-[60vh] overflow-auto grid gap-2">
        {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
        {!loading && filtered.length === 0 && <div className="text-sm text-muted-foreground">{t("no_labels")}</div>}
        {filtered.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${l.tailwindClassName ?? "bg-muted"}`}>{l.name}</span>
              <div className="text-sm text-muted-foreground truncate">{l.id}. {l.slug}</div>
            </div>
            <div className="flex items-center gap-2">
              <CreateOrUpdateLabelDialogWithButton label={l} onLabelCreated={(updatedLabel) => {
                setLabels(prev => prev.map(pl => pl.id === updatedLabel.id ? updatedLabel : pl))
              }} />
              <ConfirmDialog
                title={t("delete_label")}
                description={t("delete_label_description")}
                confirmLabel={operationT("delete")}
                cancelLabel={operationT("cancel")}
                onConfirm={handleDelete.bind(null, l.id)}
              >
                <Button variant="outline" size="icon" className="text-red-500 hover:text-red-600">
                  <Trash size={16} />
                </Button>
              </ConfirmDialog>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}