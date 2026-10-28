import type { MusicTrack } from '@/models/music'

/**
 * 列表内搜索（spec 8.11）：只在当前歌单内搜索、不联网，保留原下标，不改变上一首 / 下一首。
 * - 可搜索的字段：歌名、别名（网易云的别名与译名）、艺术家、专辑、歌曲 id；歌词等需要另行请求的内容不参与
 * - 匹配时统一全半角与大小写，忽略空白、标点与符号，平假名与片假名视为相同
 * - 空格分隔的多个关键词需全部命中（可分别命中不同字段）；结果按相关度排序，同分保持歌单顺序
 */

// 各字段的权重：歌名 > 别名 > 艺术家 > 专辑
const FIELD_WEIGHT = { name: 100, alias: 80, artist: 60, album: 40 } as const
// 字段与关键词完全相同、以关键词开头时的加分
const EXACT_BONUS = 30
const PREFIX_BONUS = 15
// 关键词是歌曲 id 时置顶
const ID_SCORE = 10_000

/** 搜索用的归一化：全半角统一、小写、片假名转平假名，去掉空白、标点与符号 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30A1-\u30F6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

interface SearchField {
  text: string
  weight: number
}

function searchFields(track: MusicTrack): SearchField[] {
  return [
    { text: track.name, weight: FIELD_WEIGHT.name },
    ...track.aliases.map(alias => ({ text: alias, weight: FIELD_WEIGHT.alias })),
    ...track.artists.map(artist => ({ text: artist, weight: FIELD_WEIGHT.artist })),
    { text: track.album, weight: FIELD_WEIGHT.album },
  ]
    .map(field => ({ text: normalizeSearchText(field.text ?? ''), weight: field.weight }))
    .filter(field => field.text)
}

/** 一个关键词在一首歌上的得分；不命中任何字段时为 0 */
function tokenScore(token: string, rawToken: string, track: MusicTrack, fields: SearchField[]): number {
  if (/^\d+$/.test(rawToken) && String(track.id) === rawToken)
    return ID_SCORE
  let best = 0
  for (const field of fields) {
    if (!field.text.includes(token))
      continue
    const score = field.weight + (field.text === token ? EXACT_BONUS : field.text.startsWith(token) ? PREFIX_BONUS : 0)
    best = Math.max(best, score)
  }
  return best
}

export function filterPlaylist(playlist: MusicTrack[], keyword: string): { track: MusicTrack, index: number }[] {
  const tokens = keyword.trim().split(/\s+/).filter(Boolean).map(raw => ({ raw, text: normalizeSearchText(raw) })).filter(token => token.text || /^\d+$/.test(token.raw))
  const all = playlist.map((track, index) => ({ track, index }))
  if (tokens.length === 0)
    return all

  const scored: { track: MusicTrack, index: number, score: number }[] = []
  for (const item of all) {
    const fields = searchFields(item.track)
    let score = 0
    for (const token of tokens) {
      const value = tokenScore(token.text, token.raw, item.track, fields)
      if (value === 0) {
        score = 0
        break
      }
      score += value
    }
    if (score > 0)
      scored.push({ ...item, score })
  }
  // 排序是稳定的：同分保持歌单顺序
  scored.sort((a, b) => b.score - a.score)
  return scored.map(({ track, index }) => ({ track, index }))
}
