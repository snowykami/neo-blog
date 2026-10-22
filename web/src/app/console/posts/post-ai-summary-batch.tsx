'use client'
import { SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { triggerAISummaryBatch } from '@/api/ai-summary'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

/**
 * 全站 AI 摘要（仅管理员）：为所有文章排队生成摘要，已是最新的摘要由后端跳过
 * 批量操作且入口在全局工具栏，按弹窗规范使用 AlertDialog 确认
 */
export function PostAISummaryBatchButton({ onQueued }: { onQueued: () => void }) {
  const t = useTranslations('Console.post_manage_ai')
  const checkboxId = useId()
  const [overwriteManual, setOverwriteManual] = useState(false)

  const handleConfirm = async () => {
    const { data } = await triggerAISummaryBatch(overwriteManual)
    const skipped = t('batch_skipped', {
      upToDate: data.skippedUpToDate,
      manual: data.skippedManual,
      empty: data.skippedEmpty,
      running: data.skippedRunning,
    })
    if (data.queued > 0)
      toast.success(t('batch_queued', { count: data.queued }), { description: skipped })
    else
      toast.info(t('batch_nothing'), { description: skipped })
    onQueued()
  }

  return (
    <ConfirmDialog
      title={t('batch_title')}
      description={t('batch_description')}
      content={(
        <div className="flex items-start gap-3">
          <Checkbox
            id={checkboxId}
            checked={overwriteManual}
            onCheckedChange={checked => setOverwriteManual(checked === true)}
          />
          <div className="grid gap-1">
            <Label htmlFor={checkboxId}>{t('batch_overwrite_manual')}</Label>
            <p className="text-xs text-muted-foreground">{t('batch_overwrite_manual_desc')}</p>
          </div>
        </div>
      )}
      confirmLabel={t('batch_confirm')}
      confirmVariant="default"
      errorText={t('batch_failed')}
      onConfirm={handleConfirm}
    >
      <Button size="sm" variant="outline">
        <SparklesIcon aria-hidden />
        {t('batch_button')}
      </Button>
    </ConfirmDialog>
  )
}
