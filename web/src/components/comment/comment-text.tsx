'use client'

import type { ReactNode } from 'react'
import type { CommentMention } from '@/models/comment'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { CommentContent } from './comment-content'

/**
 * 评论正文文字：超过站点配置的行数时先折叠，点「展开」读全文
 * - 只在内容确实超出时才出现展开按钮：先按未折叠状态量一次完整高度，再决定是否截断
 * - 折叠使用 -webkit-line-clamp，@提及 仍然渲染成链接；换行与断词规则由外层容器决定
 */
export function CommentText({
  content,
  mentions,
  lines,
  prefix,
}: {
  content: string
  mentions?: CommentMention[]
  lines: number // 折叠展示的行数，来自站点配置
  // 正文前面的一段内容（回复时的「@某人」），随正文一起参与折叠
  prefix?: ReactNode
}) {
  const t = useTranslations('Comment')
  const ref = useRef<HTMLSpanElement>(null)
  const [collapsible, setCollapsible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 未折叠状态下量完整高度，超过允许的行数才折叠（在绘制前完成，不会闪一下全文）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el)
      return
    const style = window.getComputedStyle(el)
    const fontSize = Number.parseFloat(style.fontSize) || 16
    const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.6 : Number.parseFloat(style.lineHeight) || fontSize * 1.6
    setCollapsible(el.scrollHeight > lineHeight * lines + 1)
  }, [content, mentions, lines])

  const clamped = collapsible && !expanded

  return (
    <>
      {/* 块级元素才能量出完整高度：行内元素的 scrollHeight 恒为 0 */}
      <span
        ref={ref}
        className="block"
        style={clamped
          ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' }
          : undefined}
      >
        {prefix}
        <CommentContent content={content} mentions={mentions} />
      </span>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          aria-expanded={expanded}
          className={cn(
            'mt-0.5 inline-flex items-center gap-0.5 rounded-sm align-baseline text-xs font-medium text-primary',
            'hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          {expanded ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
          {expanded ? t('show_less') : t('show_more')}
        </button>
      )}
    </>
  )
}
