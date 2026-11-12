import type { CommentMention } from '@/models/comment'

/**
 * @ 提及的边界规则，与后端 internal/service/comment_mention.go 的 mentionsUser 一致
 * （两边共用 internal/service/testdata/mention_boundary_cases.json 的用例）：
 * - @ 前面是行首、空白或常见标点（邮箱、abc@name 不算）
 * - @ 后是完整的用户名，后面不能紧跟字母、数字（含下划线与组合附加符号）；可以接标点，句末的「@alice.」也算
 */
const BOUNDARY_BEFORE = /[\s（(【[「,，.。:：;；!！?？>]/u
const CONTINUATION = /[\p{L}\p{N}\p{M}_]/u
// 正文里手打的 @某某（对不上名单时用于按顺序对齐）：名字取到空白、@、/ 为止，最多 20 个字符，去掉句末标点
const LOOSE_NAME = /^[^\s@/]{1,20}/u
const TRAILING_PUNCTUATION = /[.,!?;:。，！？；：、…)）\]】」'"’”-]+$/u

/** @ 前一个字符（undefined 表示行首）是否允许出现提及 */
export function isMentionBoundaryBefore(char: string | undefined): boolean {
  return char === undefined || BOUNDARY_BEFORE.test(char)
}

/** 在 text 的 index 位置插入 @ 时，前面是否需要自动补一个空格以满足边界规则 */
export function needsSpaceBeforeMention(text: string, index: number): boolean {
  return !isMentionBoundaryBefore(charBefore(text, index))
}

/** 取 index 处的完整字符（含代理对） */
function charAt(text: string, index: number): string | undefined {
  const code = text.codePointAt(index)
  return code === undefined ? undefined : String.fromCodePoint(code)
}

/** index 之前的一个完整字符（含代理对） */
function charBefore(text: string, index: number): string | undefined {
  if (index <= 0)
    return undefined
  const low = text.charCodeAt(index - 1)
  if (index >= 2 && low >= 0xDC00 && low <= 0xDFFF) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xD800 && high <= 0xDBFF)
      return text.slice(index - 2, index)
  }
  return text[index - 1]
}

/** start 处（指向 @）是否正好写着 @username 且满足边界规则 */
function mentionAt(content: string, start: number, username: string): boolean {
  if (!username || !content.startsWith(`@${username}`, start))
    return false
  if (!isMentionBoundaryBefore(charBefore(content, start)))
    return false
  const next = charAt(content, start + 1 + username.length)
  return next === undefined || !CONTINUATION.test(next)
}

/** 正文里是否写了 @username（提交时只认仍留在正文里的提及，与后端校验一致） */
export function mentionsUser(content: string, username: string): boolean {
  if (!username)
    return false
  for (let index = content.indexOf(`@${username}`); index >= 0; index = content.indexOf(`@${username}`, index + 1)) {
    if (mentionAt(content, index, username))
      return true
  }
  return false
}

/** 输入框里光标前正在输入的 @片段：start 是 @ 的位置，query 是 @ 之后已经输入的字符 */
export interface MentionQuery {
  start: number
  query: string
}

/** 检查光标前是否正在输入一个提及：@ 前的边界与渲染、后端一致，片段里不能有空白，最长 20 个字符 */
export function detectMentionQuery(text: string, cursor: number): MentionQuery | null {
  const before = text.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at < 0 || !isMentionBoundaryBefore(charBefore(before, at)))
    return null
  const fragment = before.slice(at + 1)
  if (/\s/.test(fragment) || [...fragment].length > 20)
    return null
  return { start: at, query: fragment }
}

/** 渲染片段：普通文本，或一个指向被 @ 用户的链接 */
export type MentionSegment
  = | { type: 'text', text: string }
    | { type: 'mention', id: number, username: string, nickname: string }

/** 正文里所有边界合法的 @某某：start 指向 @，looseEnd 是按「手打名字」估计的结尾 */
function mentionTokens(content: string) {
  const tokens: { start: number, looseEnd: number }[] = []
  for (let index = content.indexOf('@'); index >= 0; index = content.indexOf('@', index + 1)) {
    if (!isMentionBoundaryBefore(charBefore(content, index)))
      continue
    const loose = (LOOSE_NAME.exec(content.slice(index + 1))?.[0] ?? '').replace(TRAILING_PUNCTUATION, '')
    if (loose)
      tokens.push({ start: index, looseEnd: index + 1 + loose.length })
  }
  return tokens
}

/**
 * 把评论正文切成「文本 + 提及」片段。以 mention 列表里的 **id 对应的当前用户名** 为准：
 * - 名字没改：按边界规则逐个对上完整的用户名（多个都能对上时取最长的，@alice.bob 不会只链到 alice）
 * - 有人改了名：剩余数量能一一对应时按出现顺序对齐（选择器插入的顺序就是正文里的顺序）
 * - 正文里手打的 @、或对不上号的名字：当作普通文本，不生成链接
 *   （否则旧名字被别人注册后，读者会被链到一个陌生人）
 */
export function resolveMentions(content: string, mentions: CommentMention[] = []): MentionSegment[] {
  const tokens = mentions.length === 0 ? [] : mentionTokens(content)
  if (tokens.length === 0)
    return [{ type: 'text', text: content }]

  const segments: MentionSegment[] = []
  const unused = [...mentions]
  let cursor = 0
  tokens.forEach((token, tokenIndex) => {
    // 前一个提及的名字里带 @（理论上不会）时跳过被它覆盖的位置
    if (token.start < cursor)
      return
    // 先按用户名精确匹配（改名前后都能对上的情况），取最长的
    let picked = unused
      .filter(mention => mentionAt(content, token.start, mention.username))
      .sort((a, b) => b.username.length - a.username.length)[0]
    let end = picked ? token.start + 1 + picked.username.length : token.looseEnd
    if (!picked) {
      // 名字变了：只有在「剩余人数与剩余 @ 数量一致」时才按顺序对齐，避免错位
      const remainingTokens = tokens.length - tokenIndex
      if (unused.length === remainingTokens) {
        picked = unused[0]
        end = token.looseEnd
      }
    }
    if (!picked)
      return
    unused.splice(unused.indexOf(picked), 1)
    if (token.start > cursor)
      segments.push({ type: 'text', text: content.slice(cursor, token.start) })
    segments.push({ type: 'mention', id: picked.id, username: picked.username, nickname: picked.nickname })
    cursor = end
  })
  if (cursor < content.length)
    segments.push({ type: 'text', text: content.slice(cursor) })
  return segments
}

export interface MentionHighlightSegment {
  text: string
  matched: boolean
}

/**
 * 把输入框正文切成「普通文本 / 已生效的 @用户名」片段，供 Textarea 底层同色高亮镜像使用：
 * - 只高亮在候选列表里实际选中过（或编辑时原有）的有效用户名，手打未选中的 @某某 保持普通文本
 * - 严格复用 mentionAt 边界规则，且拼接后与原字符串逐字符一致，绝不改变字符宽度与光标位置
 */
export function highlightMentions(content: string, activeUsernames: string[]): MentionHighlightSegment[] {
  if (!content)
    return []
  const names = [...new Set(activeUsernames.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (names.length === 0)
    return [{ text: content, matched: false }]

  const segments: MentionHighlightSegment[] = []
  let cursor = 0
  for (let index = content.indexOf('@'); index >= 0; index = content.indexOf('@', index + 1)) {
    if (index < cursor)
      continue
    const matchedName = names.find(username => mentionAt(content, index, username))
    if (!matchedName)
      continue
    if (index > cursor)
      segments.push({ text: content.slice(cursor, index), matched: false })
    const end = index + 1 + matchedName.length
    segments.push({ text: content.slice(index, end), matched: true })
    cursor = end
  }
  if (cursor < content.length)
    segments.push({ text: content.slice(cursor), matched: false })
  return segments
}
