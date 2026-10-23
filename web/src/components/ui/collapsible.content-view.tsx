'use client'

import type { CollapsibleContentProps } from './collapsible.content'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** 折叠块：点击标题展开 / 收起正文 */
export default function CollapsibleContentView({ title, content, defaultOpen }: CollapsibleContentProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/collapsible rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-medium">
        {title}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-foreground/80">
        {content}
      </CollapsibleContent>
    </Collapsible>
  )
}
