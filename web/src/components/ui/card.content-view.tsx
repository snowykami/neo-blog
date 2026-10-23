'use client'

import type { CardContentProps } from './card.content'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** 卡片：标题、副标题与正文 */
export default function CardContentView({ title, description, content }: CardContentProps) {
  return (
    <Card className="gap-3 rounded-xl py-5 shadow-none">
      <CardHeader className="px-5">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {content && <CardContent className="px-5 text-sm leading-relaxed whitespace-pre-line text-foreground/80">{content}</CardContent>}
    </Card>
  )
}
