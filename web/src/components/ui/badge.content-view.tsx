'use client'

import { Badge } from '@/components/ui/badge'

export interface BadgeItemProps {
  text: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
}

export interface BadgesContentProps {
  items: BadgeItemProps[]
}

/** 一组徽章 */
export default function BadgesContent({ items = [] }: BadgesContentProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <Badge key={index} variant={item.variant ?? 'secondary'} className="rounded-md">{item.text ?? ''}</Badge>
      ))}
    </div>
  )
}
