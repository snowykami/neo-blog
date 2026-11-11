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
  /** 蒙版（遮罩）不透明度，0-1：有背景图时越高正文越清晰；没有背景图时就是纯色背景的不透明度 */
  veil?: number
  /** 蒙版颜色，任意 CSS 颜色；留空则跟随主题底色。没有背景图时这个颜色本身就是纯色背景 */
  veilColor?: string
  /** 是否显示节日装饰（正文两侧留白处的插画） */
  decorations?: boolean
}

/**
 * 顶栏灵动岛（实验性）的开关，后台「前台 → 顶栏灵动岛」配置；enabled 为总开关，关闭时标题区只显示站名。
 * 各项含义见 contexts/topbar-island.ts 的 IslandFeature
 */
export interface IslandSettings {
  enabled: boolean
  expand: boolean
  music: boolean
  musicPeek: boolean
  musicPaused: boolean
  musicBeat: boolean
  musicChorus: boolean
  reading: boolean
  readingFinish: boolean
  feedback: boolean
  upload: boolean
  update: boolean
  network: boolean
  holiday: boolean
  greeting: boolean
  weather: boolean
}

export interface SiteInfo {
  colorSchemes: string[]
  defaultColorScheme: string
  contentTheme?: string // 站点默认的文章内容主题，文章未单独选择时使用
  baseUrl?: string
  defaultLanguage?: string // 站点语言（如 zh-cn）：没有语言偏好的访客（含搜索引擎爬虫）看到的界面语言
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
  commentMaxLength: number // 单条评论的字数上限（后台可配置）
  commentCollapsedLines: number // 评论正文超过多少行时先折叠
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
  island?: IslandSettings // 顶栏灵动岛（实验性）的开关
}

// 取不到站点信息时的兜底，也用来补全站点信息里缺少的字段：取值与后端配置注册表（internal/config/items.go）的默认值一致。
// 开源默认值是中性占位，不放任何人的个人信息
export const fallbackSiteInfo: SiteInfo = {
  colorSchemes: ['blue', 'green', 'orange', 'red', 'rose', 'pink', 'violet', 'yellow'],
  defaultColorScheme: 'blue',
  contentTheme: 'default',
  metadata: {
    name: 'My Blog',
    icon: '',
    description: 'A neo blog system',
  },
  keywords: [],
  defaultCover: [],
  owner: {
    name: 'Blogger',
    description: '',
    motto: '',
    avatar: '',
    gravatarEmail: '',
  },
  postsPerPage: 10,
  commentsPerPage: 10,
  commentMaxLength: 500,
  commentCollapsedLines: 6,
  verifyCodeCoolDown: 60,
  animationDurationSecond: 0.618,
  copyright: 'CC BY-NC-SA 4.0',
  // 链接不单独兜底：站点信息缺这个字段时（如只保存过协议名称）不能补上别的协议的链接，名称是兜底值时由版权卡片配上对应链接
  copyrightLink: '',
  footer: {
    text: '',
    // 默认不展示额外链接，由后台「页脚链接」配置
    links: [],
  },
  aboutBackground: '',
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
  // 与后端 internal/config/items.go 的默认值一致：后台还没保存过时站点信息里没有这些字段
  island: {
    enabled: true,
    expand: true,
    music: true,
    musicPeek: true,
    musicPaused: true,
    musicBeat: true,
    musicChorus: true,
    reading: true,
    readingFinish: true,
    feedback: true,
    upload: true,
    update: true,
    network: true,
    holiday: true,
    greeting: true,
    weather: false,
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
