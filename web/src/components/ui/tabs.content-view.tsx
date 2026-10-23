'use client'

import type { TextTabsContentProps } from './tabs.content'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** 文本标签页：多段内容切换展示 */
export default function TextTabsContent({ tabs }: TextTabsContentProps) {
  return (
    <Tabs defaultValue="0" className="gap-3">
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {tabs.map((tab, index) => (
          // 标签名可能重复，以下标作为值
          <TabsTrigger key={index} value={String(index)} className="flex-none">{tab.label}</TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab, index) => (
        <TabsContent key={index} value={String(index)} className="rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-foreground/80">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
