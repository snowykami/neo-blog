'use client'

import type { DragEndEvent, DraggableAttributes, UniqueIdentifier } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import type { CSSProperties, ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SortableItemRenderContext {
  isDragging: boolean
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
  setActivatorNodeRef: (element: HTMLElement | null) => void
}

const MEASURING_CONFIG = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
}

function SortableRowShell({
  id,
  disabled,
  className,
  draggingClassName,
  children,
}: {
  id: UniqueIdentifier
  disabled?: boolean
  className?: string
  draggingClassName?: string
  children: (ctx: SortableItemRenderContext) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })

  // 使用 Translate 而非 Transform，避免不等高卡片（如展开输入框的侧边栏组件卡片）在换位时发生纵向拉伸形变
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative rounded-lg motion-reduce:transition-none',
        isDragging && cn(
          'z-20 bg-card shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12),0_2px_6px_-1px_rgba(0,0,0,0.06)] ring-1 ring-primary/35 dark:shadow-[0_10px_28px_-4px_rgba(0,0,0,0.5)]',
          draggingClassName,
        ),
        className,
      )}
    >
      {children({
        isDragging,
        attributes,
        listeners,
        setActivatorNodeRef,
      })}
    </div>
  )
}

/**
 * 拖拽手柄按钮：仅绑定在手柄上，避免阻断行内输入框、开关或操作按钮的点击与文本选中
 */
export function SortableDragHandle({
  ctx,
  label,
  disabled,
  className,
}: {
  ctx: SortableItemRenderContext
  label?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      ref={ctx.setActivatorNodeRef}
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      {...ctx.attributes}
      {...ctx.listeners}
      className={cn(
        'inline-flex size-7 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
        ctx.isDragging ? 'cursor-grabbing text-primary' : 'cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      <GripVerticalIcon className="size-4" aria-hidden />
    </button>
  )
}

/**
 * 通用纵向拖拽排序列表（可用于侧边栏卡片、导航菜单页面、友链分组等任意后台排序场景）
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  disabled = false,
  className,
  itemClassName,
  draggingItemClassName,
}: {
  items: readonly T[]
  getId: (item: T, index: number) => UniqueIdentifier
  onReorder: (nextItems: T[], fromIndex: number, toIndex: number) => void
  renderItem: (item: T, index: number, ctx: SortableItemRenderContext) => ReactNode
  disabled?: boolean
  className?: string
  itemClassName?: string
  draggingItemClassName?: string
}) {
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const ids = items.map((item, idx) => getId(item, idx))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id)
      return
    const fromIndex = ids.indexOf(active.id)
    const toIndex = ids.indexOf(over.id)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
      return
    onReorder(arrayMove([...items], fromIndex, toIndex), fromIndex, toIndex)
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={MEASURING_CONFIG}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={cn('grid gap-2', className)}>
          {items.map((item, index) => {
            const id = ids[index]
            return (
              <SortableRowShell
                key={id}
                id={id}
                disabled={disabled || items.length <= 1}
                className={itemClassName}
                draggingClassName={draggingItemClassName}
              >
                {ctx => renderItem(item, index, ctx)}
              </SortableRowShell>
            )
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
