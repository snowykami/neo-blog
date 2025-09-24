import { OrderBy } from "@/models/common"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

interface Order {
  orderBy: OrderBy
  desc: boolean
}

export function OrderSelector({ initialOrder, onOrderChange }: { initialOrder: Order, onOrderChange: (order: Order) => void }) {
  const orderT = useTranslations("Order")
  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState<Order>(initialOrder)

  const orderBys = [OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.Heat, OrderBy.CommentCount, OrderBy.LikeCount, OrderBy.ViewCount]

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {orderT(order.orderBy)} {order.desc ? "↓" : "↑"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-0" align="end" side="bottom" sideOffset={8}>
        <div className="flex flex-col">
          {orderBys.map((ob) => (
            [true, false].map((desc) => (
              <Button
                key={`${ob}-${desc}`}
                variant="ghost"
                size="sm"
                className={`justify-start ${order.orderBy === ob && order.desc === desc ? "bg-accent" : ""}`}
                onClick={() => {
                  onOrderChange({ orderBy: ob, desc })
                  setOrder({ orderBy: ob, desc })
                  setOpen(false)
                }}
              >
                {orderT(ob)} {desc ? "↓" : "↑"}
              </Button>
            ))
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}