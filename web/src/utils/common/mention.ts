import type { CommentMention } from '@/models/comment'

// 正文里的 @用户名：前面必须是行首或空白 / 常见前置标点，名字是 1～20 个用户名可用字符
const MENTION_PATTERN = /(^|[\s（(【[「])@([\p{L}\p{N}_.-]{1,20})/gu

/** 渲染片段：普通文本，或一个指向被 @ 用户的链接 */
export type MentionSegment
  = | { type: 'text', text: string }
    | { type: 'mention', id: number, username: string, nickname: string }

/**
 * 把评论正文切成「文本 + 提及」片段。以 mention 列表里的 **id 对应的当前用户名** 为准：
 * - 名字没改：逐个按用户名对上
 * - 有人改了名：剩余数量能一一对应时按出现顺序对齐（选择器插入的顺序就是正文里的顺序）
 * - 正文里手打的 @、或对不上号的名字：当作普通文本，不生成链接
 *   （否则旧名字被别人注册后，读者会被链到一个陌生人）
 */
export function resolveMentions(content: string, mentions: CommentMention[] = []): MentionSegment[] {
  const tokens = [...content.matchAll(MENTION_PATTERN)].map(match => ({
    start: (match.index ?? 0) + match[1].length,
    end: (match.index ?? 0) + match[0].length,
    username: match[2],
  }))
  const segments: MentionSegment[] = []
  if (tokens.length === 0 || mentions.length === 0) {
    return [{ type: 'text', text: content }]
  }

  const unused = [...mentions]
  let cursor = 0
  tokens.forEach((token, tokenIndex) => {
    // 先按用户名精确匹配（改名前后都能对上的情况）
    let picked = unused.find(mention => mention.username === token.username)
    if (!picked) {
      // 名字变了：只有在「剩余人数与剩余 @ 数量一致」时才按顺序对齐，避免错位
      const remainingTokens = tokens.length - tokenIndex
      if (unused.length === remainingTokens)
        picked = unused[0]
    }
    if (!picked) {
      return
    }
    unused.splice(unused.indexOf(picked), 1)
    if (token.start > cursor)
      segments.push({ type: 'text', text: content.slice(cursor, token.start) })
    segments.push({ type: 'mention', id: picked.id, username: picked.username, nickname: picked.nickname })
    cursor = token.end
  })
  if (cursor < content.length)
    segments.push({ type: 'text', text: content.slice(cursor) })
  return segments
}
