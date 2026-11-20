import type { LucideIconNode } from 'lucide-react'
import type { IconChildNode, ResolvedIconSpec, SvgChildTag } from './types'
import type { CatalogIconComponent, IconCatalog, IconCatalogEntry } from '@/lib/inline-icon/catalog'
import { createElement } from 'react'
import { loadIconCatalog } from '@/lib/inline-icon/catalog'
import { getDynamicIconImports, isIconName } from '@/lib/inline-icon/icon'
import { IconSpecSvg } from './icon-spec-svg'
import { BRAND_ICON_PREFIX, fallbackLabelFromIconName, isOwnerLinkIconName } from './types'

interface GeneratedSocialIcon {
  id: string
  label: string
  words: string
  spec: ResolvedIconSpec
}

interface GeneratedSocialIconsFile {
  icons: GeneratedSocialIcon[]
}

export const SOCIAL_BRANDS_CATEGORY = 'brands'

const ALLOWED_TAGS = new Set<SvgChildTag>(['path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse', 'g'])

let socialIconsPromise: Promise<Map<string, GeneratedSocialIcon>> | null = null

export function loadSocialIconMap(): Promise<Map<string, GeneratedSocialIcon>> {
  socialIconsPromise ??= import('./social-icons.generated.json')
    .then((mod) => {
      const data = (mod.default ?? mod) as GeneratedSocialIconsFile
      return new Map(data.icons.map(item => [`${BRAND_ICON_PREFIX}${item.id}`, item]))
    })
    .catch((err) => {
      socialIconsPromise = null
      throw err
    })
  return socialIconsPromise
}

function lucideNodeToChild(node: LucideIconNode): IconChildNode | null {
  const [tag, attrs, children] = node
  if (!ALLOWED_TAGS.has(tag as SvgChildTag))
    return null
  const cleanAttrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== 'key' && v != null)
      cleanAttrs[k] = String(v)
  }
  const cleanChildren = children?.map(lucideNodeToChild).filter((c): c is IconChildNode => c !== null)
  return cleanChildren?.length
    ? { tag: tag as SvgChildTag, attr: cleanAttrs, child: cleanChildren }
    : { tag: tag as SvgChildTag, attr: cleanAttrs }
}

const resolvedCache = new Map<string, Promise<ResolvedIconSpec | null>>()

/**
 * 解析站长链接图标（支持 `brand:*` 社交平台图标与全部 Lucide 图标）为纯 SVG 节点树
 */
export function resolveOwnerIconSpec(name: string): Promise<ResolvedIconSpec | null> {
  if (!isOwnerLinkIconName(name))
    return Promise.resolve(null)
  let pending = resolvedCache.get(name)
  if (!pending) {
    if (name.startsWith(BRAND_ICON_PREFIX)) {
      pending = loadSocialIconMap()
        .then(map => map.get(name)?.spec ?? null)
        .catch(() => {
          resolvedCache.delete(name)
          return null
        })
    }
    else if (isIconName(name)) {
      pending = getDynamicIconImports()
        .then(async (imports) => {
          if (!Object.hasOwn(imports, name))
            return null
          const mod = await imports[name as keyof typeof imports]()
          const nodes = mod.__iconData.node.map(lucideNodeToChild).filter((n): n is IconChildNode => n !== null)
          return nodes.length ? { viewBox: '0 0 24 24', stroke: true, nodes } : null
        })
        .catch(() => {
          resolvedCache.delete(name)
          return null
        })
    }
    else {
      return Promise.resolve(null)
    }
    resolvedCache.set(name, pending)
  }
  return pending
}

/**
 * 获取图标对应的默认平台可读名称（如 `brand:steam` -> `Steam`；带中文括注的取精简主名或完整名）
 */
export async function resolveOwnerIconLabel(name: string): Promise<string> {
  if (name.startsWith(BRAND_ICON_PREFIX)) {
    const map = await loadSocialIconMap().catch(() => null)
    const entry = map?.get(name)
    if (entry) {
      // 去掉末尾括注说明（如「微信 (WeChat)」保留「微信」，「X (Twitter)」保留「X」）以保持气泡简洁
      return entry.label.replace(/\s*\([^)]*\)\s*$/, '').trim() || entry.label
    }
  }
  return fallbackLabelFromIconName(name)
}

let extendedCatalogPromise: Promise<IconCatalog> | null = null

/**
 * 加载合并了「常用平台图标（brand:*）」与「全部 Lucide 图标」的可检索目录（仅在后台打开选择器时按需加载）
 */
export function loadSocialAndLucideCatalog(): Promise<IconCatalog> {
  extendedCatalogPromise ??= Promise.all([loadSocialIconMap(), loadIconCatalog()])
    .then(([socialMap, lucideCatalog]) => {
      const categories = [SOCIAL_BRANDS_CATEGORY, ...lucideCatalog.categories]
      const brandComponents = new Map<string, CatalogIconComponent>()
      const brandEntries: IconCatalogEntry[] = []

      for (const [fullName, item] of socialMap.entries()) {
        const words = [...new Set(
          `${item.label.toLowerCase()} ${item.words.toLowerCase()}`
            .replace(/[()/]/g, ' ')
            .split(/[\s,]+/)
            .filter(Boolean),
        )]
        brandEntries.push({
          name: fullName,
          words,
          categories: [0],
          label: item.label,
        })
        const BrandComponent: CatalogIconComponent = ({ className }) => createElement(IconSpecSvg, { spec: item.spec, className })
        brandComponents.set(fullName, BrandComponent)
      }

      const shiftedLucideEntries: IconCatalogEntry[] = lucideCatalog.icons.map(icon => ({
        ...icon,
        categories: icon.categories.map(index => index + 1),
      }))

      return {
        categories,
        icons: [...brandEntries, ...shiftedLucideEntries],
        component: (name: string) => brandComponents.get(name) ?? lucideCatalog.component(name),
      }
    })
    .catch((err) => {
      extendedCatalogPromise = null
      throw err
    })
  return extendedCatalogPromise
}
