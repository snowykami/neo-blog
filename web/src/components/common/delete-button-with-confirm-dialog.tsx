import { Trash2 } from 'lucide-react'
import { useOperationT } from '@/hooks/use-translations'
import { Button } from '../ui/button'
import { ConfirmDialog } from './confirm-dialog'

export function DeleteButtonWithConfirmDialog({ onDelete }: { onDelete: () => void | Promise<void> }) {
  const operationT = useOperationT()
  return (
    <ConfirmDialog
      title={operationT('confirm_delete')}
      description={operationT('delete_description')}
      confirmLabel={operationT('delete')}
      cancelLabel={operationT('cancel')}
      confirmVariant="destructive"
      onConfirm={onDelete}
    >
      <Button variant="outline" size="icon" className="text-red-500 hover:text-red-600" aria-label={operationT('delete')}>
        <Trash2 className="size-4" />
      </Button>
    </ConfirmDialog>
  )
}
