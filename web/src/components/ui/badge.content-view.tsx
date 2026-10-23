'use client'

import type { BadgesContentProps } from './badge.content'
import { Badge } from '@/components/ui/badge'

/** 一组徽章 */
export default function BadgesContent({ items }: BadgesContentProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <Badge key={index} variant={item.variant} className="rounded-md">{item.text}</Badge>
      ))}
    </div>
  )
}
