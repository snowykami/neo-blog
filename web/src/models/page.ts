import type { User } from './user'

// 前台版式：reading 阅读（正文 + 目录侧边栏，外框与顶栏对齐）/ wide 宽屏（正文占满整行）
export const PAGE_LAYOUTS = ['reading', 'wide'] as const

export type PageLayout = typeof PAGE_LAYOUTS[number]

// 页面类型：content 正文页面（用编辑器撰写）；link 链接页面，在导航中直接跳转到站内路径（/ 开头）或站外地址（新窗口打开）；
// html HTML 页面（仅管理员），上传静态 HTML 包，前台在沙箱 iframe 中展示
export const PAGE_KINDS = ['content', 'link', 'html'] as const

export type PageKind = typeof PAGE_KINDS[number]

// HTML 页面的显示尺寸：fill 占满导航栏以下的视口 / ratio 固定宽高比 / height 固定高度
export const PAGE_HTML_SIZE_MODES = ['fill', 'ratio', 'height'] as const

export type PageHtmlSizeMode = typeof PAGE_HTML_SIZE_MODES[number]

// HTML 页面当前生效版本的访问信息
export interface PageHtmlBundle {
  version: number
  entry: string
  url: string // 入口文件地址：默认为站内相对路径，配置了独立源时为该源下的绝对地址
  allowSameOrigin: boolean // 由独立的无 Cookie 源托管，iframe 可以放开 allow-same-origin
}

export interface PageHtmlFile {
  path: string
  size: number
  mimeType: string
}

// HTML 页面的一个版本（仅管理员可见）
export interface PageHtmlVersion {
  id: number
  version: number
  entry: string
  sourceName: string
  totalSize: number
  files: PageHtmlFile[]
  url: string
  active: boolean
  allowSameOrigin: boolean
  createdAt: string
}

export interface PageModel {
  id: number
  userId: number
  user: User
  title: string
  slug: string
  description: string
  cover: string
  content: string
  draftContent?: string | null // 仅单篇草稿模式返回，列表接口不包含
  type: 'markdown' | 'html'
  isPrivate: boolean
  showInNav: boolean
  navOrder: number
  layout: PageLayout
  kind: PageKind
  linkUrl: string
  // 全屏页面：正文占满视口，顶栏收起为顶部的手势条
  fullscreen: boolean
  htmlSizeMode: PageHtmlSizeMode
  htmlAspectRatio: string // 固定宽高比，如 16:9
  htmlHeight: number // 固定高度（px）
  htmlBundle?: PageHtmlBundle | null // 仅单页详情返回，未上传时为空
  createdAt: string
  updatedAt: string
}
