'use client'

import type { CommentMention } from '@/models/comment'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { resolveMentions } from '@/utils/common/mention'

/**
 * 评论正文：纯文本，只把被 @ 的人渲染成指向个人主页的链接。
 * 渲染以 mention 列表里的 id 为准——用户改名后显示新名字，绝不会链到占用了旧名字的陌生人；
 * 译文里不解析提及（AI 译文里的名字不保证是用户名）
 */
export function CommentContent({ content, mentions }: { content: string, mentions?: CommentMention[] }) {
  const t = useTranslations('Comment')
  const segments = resolveMentions(content, mentions)
  return (
    <>
      {segments.map((segment, index) => segment.type === 'text'
        ? <span key={`text-${index}`}>{segment.text}</span>
        : (
            <Link
              key={`mention-${segment.id}-${index}`}
              href={`/u/${segment.username}`}
              className="text-primary hover:underline"
              title={t('mention_profile', { username: segment.username })}
            >
              @
              {segment.username}
            </Link>
          ))}
    </>
  )
}
