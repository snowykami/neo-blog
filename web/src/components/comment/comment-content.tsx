'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

// @用户名：前面必须是行首或空白，后面跟 2～20 个用户名可用字符，避免把邮箱当成提及
const MENTION_PATTERN = /(^|[\s（(【[「])@([\p{L}\p{N}_.-]{1,20})/gu

/**
 * 评论正文：纯文本，只把 @用户名 渲染成指向个人主页的链接。
 * 用户名可能被改过，改了就退化成普通文本（已发出的通知不受影响）；
 * 译文里不解析提及（译文由 AI 生成，@ 后面的名字不保证是用户名）
 */
export function CommentContent({ content }: { content: string }) {
  const t = useTranslations('Comment')
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  for (match of content.matchAll(MENTION_PATTERN)) {
    const [whole, prefix, username] = match
    const start = match.index ?? 0
    // 前缀（空白或标点）原样输出
    parts.push(content.slice(lastIndex, start) + prefix)
    parts.push(
      <Link
        key={`${start}-${username}`}
        href={`/u/${username}`}
        className="text-primary hover:underline"
        title={t('mention_profile', { username })}
      >
        @
        {username}
      </Link>,
    )
    lastIndex = start + whole.length
  }
  parts.push(content.slice(lastIndex))
  return <>{parts}</>
}
