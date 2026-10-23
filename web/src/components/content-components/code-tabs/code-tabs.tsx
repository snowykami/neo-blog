'use client'

import type { CodeTabsProps } from './schema'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import copyToClipboard from '@/lib/clipboard'
import hljs from '@/lib/highlight'

/** 高亮代码：hljs 输出的 HTML 已转义源码；未注册的语言返回 null，按纯文本渲染 */
function highlight(code: string, language: string): string | null {
  if (!language || !hljs.getLanguage(language))
    return null
  return hljs.highlight(code, { language, ignoreIllegals: true }).value
}

/** 代码组：多段代码以标签页切换，外观与正文代码块一致（深色容器 + 复制按钮） */
export default function CodeTabs({ tabs }: CodeTabsProps) {
  const t = useTranslations('CodeBlock')
  const [active, setActive] = useState('0')
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => tabs.map(tab => highlight(tab.code, tab.language)), [tabs])

  const copy = async () => {
    const ok = await copyToClipboard(tabs[Number(active)]?.code ?? '')
    if (!ok) {
      toast.error(t('copy_failed'))
      return
    }
    toast.success(t('copy_success'))
    setCopied(true)
    setTimeout(setCopied, 1200, false)
  }

  return (
    <Tabs value={active} onValueChange={setActive} className="gap-0 overflow-hidden rounded-xl border border-white/10 bg-(--code-bg)">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 pr-2">
        <TabsList variant="underline" className="h-9 min-w-0 flex-1 justify-start border-0 px-2 text-white/55">
          {tabs.map((tab, index) => (
            <TabsTrigger
              // 标签名可能重复，以下标作为值
              key={index}
              value={String(index)}
              className="flex-none px-2 font-mono text-xs hover:text-white data-[state=active]:text-white"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <button
          type="button"
          aria-label={t('copy')}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      {tabs.map((tab, index) => (
        <TabsContent key={index} value={String(index)} className="m-0">
          <pre className="m-0 overflow-x-auto bg-transparent px-4 py-3 font-mono text-[0.875rem] leading-6 text-gray-100">
            {highlighted[index] != null
              ? <code className={`hljs language-${tab.language} !bg-transparent !p-0`} dangerouslySetInnerHTML={{ __html: highlighted[index] }} />
              : <code className="!bg-transparent !p-0">{tab.code}</code>}
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  )
}
