import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { OrderBy } from '@/models/common'

interface Order {
  orderBy: OrderBy
  desc: boolean
}

export function OrderSelector({
  value,
  initialOrder,
  onOrderChange,
  orderBys,
}: {
  /** 受控排序值（推荐），通常来自 URL 状态 */
  value?: Order
  /** @deprecated 仅在未传入 value 时作为非受控初始值，保留以兼容旧调用 */
  initialOrder?: Order
  orderBys?: OrderBy[]
  onOrderChange: (order: Order) => void
}) {
  const orderT = useTranslations('Order')
  const [innerOrder, setInnerOrder] = useState<Order>(
    initialOrder ?? { orderBy: OrderBy.CreatedAt, desc: true },
  )
  const order = value ?? innerOrder

  orderBys = orderBys || [
    OrderBy.CreatedAt,
    OrderBy.UpdatedAt,
    OrderBy.Heat,
    OrderBy.CommentCount,
    OrderBy.LikeCount,
    OrderBy.ViewCount,
  ]

  const changeOrder = (next: Order) => {
    if (value === undefined)
      setInnerOrder(next)
    onOrderChange(next)
  }

  const DirectionIcon = order.desc ? ArrowDownWideNarrowIcon : ArrowUpNarrowWideIcon
  const directionLabel = orderT(order.desc ? 'desc' : 'asc')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${orderT('order')}: ${orderT(order.orderBy)}, ${directionLabel}`}
          title={directionLabel}
        >
          <DirectionIcon className="text-muted-foreground" />
          <span className="hidden text-muted-foreground md:inline">{orderT('order')}</span>
          {orderT(order.orderBy)}
        </Button>
      </DropdownMenuTrigger>
      {/* 字段与方向分组单选；选择后保持展开，便于连续调整并直接看到列表变化 */}
      <DropdownMenuContent className="min-w-40" align="end" sideOffset={8}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{orderT('sort_by')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={order.orderBy}
          onValueChange={v => changeOrder({ orderBy: v as OrderBy, desc: order.desc })}
        >
          {orderBys.map(ob => (
            <DropdownMenuRadioItem key={ob} value={ob} onSelect={e => e.preventDefault()}>
              {orderT(ob)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{orderT('direction')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={order.desc ? 'desc' : 'asc'}
          onValueChange={v => changeOrder({ orderBy: order.orderBy, desc: v === 'desc' })}
        >
          <DropdownMenuRadioItem value="desc" onSelect={e => e.preventDefault()}>
            <ArrowDownWideNarrowIcon className="text-muted-foreground" />
            {orderT('desc')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="asc" onSelect={e => e.preventDefault()}>
            <ArrowUpNarrowWideIcon className="text-muted-foreground" />
            {orderT('asc')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
