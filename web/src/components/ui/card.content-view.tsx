'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface CardContentProps {
  title: string
  description: string
  content: string
}

/** 卡片：标题、副标题与正文 */
export default function CardContentView({ title = '', description = '', content = '' }: CardContentProps) {
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
