import type { SidebarCardConfig } from '@/components/blog-sidebar/sidebar-cards'
import type { MusicSourceType } from '@/models/music'

/**
 * 全站背景（前台）。值都存在站点信息 KV 里，因此后端无需改动。
 * 具体渲染见 contexts/page-background-context.tsx 与 components/layout/page-background.tsx。
 */
export interface PageBackground {
  /** 是否启用自定义背景（后台不再暴露开关：填了背景图即生效；页面级可用它临时关掉） */
  enabled?: boolean
  /** 铺满视口的背景图；留空则只用底色 */
  image?: string
  /** 高斯模糊程度，0-40（px） */
  blur?: number
  /** 图片不透明度，0-1 */
  opacity?: number
  /** 图片上方的遮罩强度，0-1，越高正文越清晰 */
  veil?: number
  /** 是否显示节日装饰（正文两侧留白处的插画） */
  decorations?: boolean
}

export interface SiteInfo {
  colorSchemes: string[]
  defaultColorScheme: string
  baseUrl?: string
  metadata: {
    name: string
    icon: string
    description: string
  }
  keywords?: string[]
  defaultCover: string | string[]
  owner: {
    name: string
    description?: string
    motto?: string
    avatar?: string
    gravatarEmail?: string
  }
  postsPerPage: number
  commentsPerPage: number
  verifyCodeCoolDown: number
  animationDurationSecond: number
  copyright?: string
  copyrightLink?: string
  footer: {
    text?: string
    links?: {
      text: string
      href: string
    }[]
  }
  // 以下为前台个性化资源，留空即隐藏对应组件
  aboutBackground?: string // 侧边栏「关于我」卡片背景图
  sidebarCards?: SidebarCardConfig[] // 文章列表页侧边栏卡片（按顺序），未配置时使用默认卡片
  sidebarIframeUrl?: string // 旧配置：侧边栏嵌入页面地址，仅在未配置 sidebarCards 时生效
  sidebarIframeTitle?: string // 旧配置：侧边栏嵌入卡片标题
  musicSource?: MusicSourceType // 悬浮音乐播放器的歌单来源，默认为静态 JSON
  musicPlaylistUrl?: string // 悬浮音乐播放器歌单 JSON 地址（静态来源）
  enableThirdPartyScript?: boolean // 是否在前台加载全局第三方脚本
  pageBackground?: PageBackground // 前台全站背景（底色 / 背景图 / 模糊 / 节日装饰）
}

export const fallbackSiteInfo: SiteInfo = {
  colorSchemes: ['blue', 'green', 'orange', 'red', 'pink', 'rose', 'violet', 'yellow'],
  defaultColorScheme: 'blue',
  metadata: {
    name: 'Fail to fetch name',
    icon: 'https://cdn.liteyuki.org/snowykami/avatar_alpha.png',
    description: 'Failed to fetch site info from server.',
  },
  keywords: ['blog', 'neo-blog', 'snowykami', '博客', '个人博客', '远野千束'],
  defaultCover: 'https://cdn.liteyuki.org/blog/background.png',
  owner: {
    name: 'Fail to fetch owner',
    description: 'This is an error description.',
    motto: 'This is a default motto.',
    avatar: '',
    gravatarEmail: '',
  },
  postsPerPage: 10,
  commentsPerPage: 10,
  verifyCodeCoolDown: 60,
  animationDurationSecond: 0.3,
  copyright: 'CC BY-NC-SA 4.0',
  copyrightLink: 'https://creativecommons.org/licenses/by/4.0/',
  footer: {
    text: 'Default footer text',
    // 默认不展示额外链接，由后台「页脚链接」配置
    links: [],
  },
  aboutBackground: 'https://cdn.liteyuki.org/snowykami/dark_2.png',
  sidebarIframeUrl: 'https://lab.liteyuki.org/embed/user-timeline/a2utaz241qx60001?maxHeight=700&border=false',
  sidebarIframeTitle: 'Misskey',
  musicPlaylistUrl: 'https://cdn.liteyuki.org/snowykami/music/playlists/favorite.json',
  enableThirdPartyScript: true,
  pageBackground: {
    // 有背景图（或自定义底色）即生效；没有图时这一层不会渲染
    enabled: true,
    blur: 0,
    opacity: 1,
    veil: 0.72,
    decorations: true,
  },
}

export function getDefaultCoverRandomly(siteInfo: SiteInfo): string {
  if (Array.isArray(siteInfo.defaultCover)) {
    if (siteInfo.defaultCover.length === 0)
      return ''
    const idx = Math.floor(Math.random() * siteInfo.defaultCover.length)
    return siteInfo.defaultCover[idx]
  }
  return siteInfo.defaultCover
}

/**
 * 安全地构造 metadataBase：baseUrl 为空或非法时返回 undefined，避免 new URL('') 抛异常导致页面 500
 */
export function safeMetadataBase(baseUrl?: string): URL | undefined {
  if (!baseUrl)
    return undefined
  try {
    return new URL(baseUrl)
  }
  catch {
    return undefined
  }
}
