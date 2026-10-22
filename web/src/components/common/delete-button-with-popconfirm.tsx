import { Trash2 } from 'lucide-react'
import { useOperationT } from '@/hooks/use-translations'
import { Button } from '../ui/button'
import { Popconfirm } from './popconfirm'

// 列表行内的删除按钮：单个对象的删除使用就地 Popconfirm 确认
export function DeleteButtonWithPopconfirm({ name, description, onDelete }: {
  name?: string // 被删除对象的名称，用于确认标题
  description?: React.ReactNode
  onDelete: () => void | Promise<void> // 失败时抛出异常，由 Popconfirm 统一提示
}) {
  const operationT = useOperationT()
  return (
    <Popconfirm
      title={name ? operationT('delete_confirm_title', { name }) : operationT('confirm_delete')}
      description={description ?? operationT('delete_description')}
      confirmText={operationT('delete')}
      errorText={operationT('delete_failed')}
      destructive
      onConfirm={onDelete}
    >
      <Button variant="outline" size="icon" className="text-red-500 hover:text-red-600" aria-label={operationT('delete')} title={operationT('delete')}>
        <Trash2 className="size-4" />
      </Button>
    </Popconfirm>
  )
}
