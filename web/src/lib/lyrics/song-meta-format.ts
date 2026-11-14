import { normalizeForMatch } from './strip-credits'

/**
 * 格式化标题括号内的副标题 / 译名列表（去重且不与原曲名重复）：
 * 返回不含外层括号的字符串；为空表示无需显示括号副标题
 */
export function formatTitleAliases(
  name: string,
  aliases: string[] = [],
  translatedTitle?: string | null,
  showTranslation = true,
): string {
  const normName = normalizeForMatch(name)
  const items: string[] = []
  const seen = new Set<string>()

  const pushUnique = (raw?: string | null) => {
    const trimmed = raw?.trim()
    if (!trimmed)
      return
    const norm = normalizeForMatch(trimmed)
    if (!norm || norm === normName || seen.has(norm))
      return
    seen.add(norm)
    items.push(trimmed)
  }

  if (showTranslation)
    pushUnique(translatedTitle)

  for (const alias of aliases)
    pushUnique(alias)

  return items.join(', ')
}

/** 单行标题拼接：`原曲名 (译名/别名)` */
export function formatInlineSongTitle(
  name: string,
  aliases: string[] = [],
  translatedTitle?: string | null,
  showTranslation = true,
): string {
  const extra = formatTitleAliases(name, aliases, translatedTitle, showTranslation)
  return extra ? `${name} (${extra})` : name
}

/** 按位置格式化每位歌手的展示名称：`原名 (译名)`，并与原名 / 已包含译名去重 */
export function formatDisplayArtists(
  artists: string[],
  translatedArtists?: string[] | null,
  showTranslation = true,
): string[] {
  if (!showTranslation || !translatedArtists || translatedArtists.length === 0)
    return artists

  return artists.map((artist, index) => {
    const tr = translatedArtists[index]?.trim()
    if (!tr)
      return artist
    const normOrig = normalizeForMatch(artist)
    const normTr = normalizeForMatch(tr)
    if (!normTr || normTr === normOrig || normOrig.includes(normTr))
      return artist
    return `${artist} (${tr})`
  })
}
