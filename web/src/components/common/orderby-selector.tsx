import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  const [open, setOpen] = useState(false)
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

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <div className="text-sm font-bold hidden md:block">{orderT('order')}</div>
          {' '}
          {orderT(order.orderBy)}
          {' '}
          {order.desc ? '↓' : '↑'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" side="bottom" sideOffset={8}>
        <div className="flex flex-col">
          {orderBys.map(ob =>
            [true, false].map(desc => (
              <Button
                key={`${ob}-${desc}`}
                variant="ghost"
                size="sm"
                className={`justify-start ${order.orderBy === ob && order.desc === desc ? 'bg-accent' : ''}`}
                onClick={() => {
                  if (value === undefined)
                    setInnerOrder({ orderBy: ob, desc })
                  onOrderChange({ orderBy: ob, desc })
                  setOpen(false)
                }}
              >
                {orderT(ob)}
                {' '}
                {desc ? '↓' : '↑'}
              </Button>
            )),
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
