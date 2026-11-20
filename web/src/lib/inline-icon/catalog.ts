import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * 图标选择器的图标目录：检索数据（lucide-meta.json，由 scripts/gen-lucide-icon-meta.mjs 生成）+ lucide-react 的全部图标组件
 * 两者体积都较大，只在打开选择器时按需加载，不进入编辑器与前台的首屏包
 */

export type CatalogIconComponent = ComponentType<{ className?: string }>

/** lucide-meta.json 的结构：icons 为 [图标名, 逗号分隔的检索词, 分类下标] */
export interface LucideMeta {
  version: string
  categories: string[]
  icons: [name: string, words: string, categories: number[]][]
}

export interface IconCatalogEntry {
  name: string
  words: string[]
  categories: number[]
  /** 可选显示名称（如社交平台图标「微信 (WeChat)」） */
  label?: string
}

export interface IconCatalog {
  categories: string[]
  icons: IconCatalogEntry[]
  component: (name: string) => CatalogIconComponent | undefined
}

/** 图标名转为 lucide-react 的导出名：a-arrow-down → AArrowDown（与 lucide 的 toPascalCase 一致） */
export function iconComponentName(name: string): string {
  return name.replace(/(?:^|-)([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

export function buildIconCatalog(meta: LucideMeta, components: Record<string, LucideIcon>): IconCatalog {
  return {
    categories: meta.categories,
    icons: meta.icons.map(([name, words, categories]) => ({ name, words: words ? words.split(',') : [], categories })),
    component: name => components[iconComponentName(name)],
  }
}

let catalogPromise: Promise<IconCatalog> | null = null

export function loadIconCatalog(): Promise<IconCatalog> {
  catalogPromise ??= Promise.all([import('./lucide-meta.json'), import('lucide-react')])
    .then(([meta, lucide]) => buildIconCatalog(meta.default as LucideMeta, lucide.icons))
    .catch((error) => {
      // 加载失败（如网络中断）后允许重试
      catalogPromise = null
      throw error
    })
  return catalogPromise
}

// 名字或检索词匹配的优先级：越小越靠前
const SCORE = {
  exact: 0,
  prefix: 1,
  segmentPrefix: 2,
  nameContains: 3,
  wordExact: 4,
  wordPrefix: 5,
  wordContains: 6,
  category: 7,
} as const

function bareIconName(name: string): string {
  const colon = name.indexOf(':')
  return colon >= 0 ? name.slice(colon + 1) : name
}

function termScore(icon: IconCatalogEntry, term: string, categoryLabels: string[]): number {
  const { name } = icon
  const bare = bareIconName(name)
  if (name === term || bare === term)
    return SCORE.exact
  if (name.startsWith(term) || bare.startsWith(term))
    return SCORE.prefix
  if (bare.split('-').some(segment => segment.startsWith(term)))
    return SCORE.segmentPrefix
  const allowShortContains = term.length >= 3 || /[\u0080-\uFFFF]/.test(term)
  if (allowShortContains && (bare.includes(term) || name.includes(term)))
    return SCORE.nameContains
  let best: number = Number.POSITIVE_INFINITY
  for (const word of icon.words) {
    if (word === term)
      return SCORE.wordExact
    if (word.startsWith(term) || word.split(' ').some(part => part.startsWith(term)))
      best = Math.min(best, SCORE.wordPrefix)
    else if (allowShortContains && word.includes(term))
      best = Math.min(best, SCORE.wordContains)
  }
  if (best < Number.POSITIVE_INFINITY)
    return best
  // 分类名（含本地化名称，中文等也能按分类检索）
  return icon.categories.some(index => categoryLabels[index]?.includes(term)) ? SCORE.category : best
}

/**
 * 按英文名、lucide 检索词与分类名检索图标；多个词时每个词都要命中，按最差一个词的匹配程度排序
 * categoryLabels 与 catalog.categories 一一对应，需为小写（本地化名称与英文键均可，用空格拼在一起）
 */
export function searchIcons(catalog: IconCatalog, query: string, categoryLabels: string[]): IconCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q)
    return catalog.icons
  const terms = q.split(/\s+/)
  const joined = terms.join('-')
  const results: { icon: IconCatalogEntry, score: number, total: number }[] = []
  for (const icon of catalog.icons) {
    const bare = bareIconName(icon.name)
    if (icon.name === joined || bare === joined) {
      results.push({ icon, score: -1, total: -1 })
      continue
    }
    let score = 0
    let total = 0
    for (const term of terms) {
      const s = termScore(icon, term, categoryLabels)
      if (!Number.isFinite(s)) {
        score = Number.POSITIVE_INFINITY
        break
      }
      score = Math.max(score, s)
      total += s
    }
    if (Number.isFinite(score))
      results.push({ icon, score, total })
  }
  return results
    .sort((a, b) => {
      if (a.score !== b.score)
        return a.score - b.score
      if (a.total !== b.total)
        return a.total - b.total
      const aBrand = a.icon.name.includes(':') ? 0 : 1
      const bBrand = b.icon.name.includes(':') ? 0 : 1
      if (aBrand !== bBrand)
        return aBrand - bBrand
      const aBare = bareIconName(a.icon.name)
      const bBare = bareIconName(b.icon.name)
      return aBare.length - bBare.length || (a.icon.name < b.icon.name ? -1 : 1)
    })
    .map(result => result.icon)
}
