export const consolePath = {
  category: '/console/categories',
  dashboard: '/console',
  label: '/console/labels',
  post: '/console/posts',
  page: '/console/pages',
  comment: '/console/comments',
  lyricEffect: '/console/lyric-effects',
  visit: '/console/visits',
  visitInsights: '/console/visit-insights',
  runtime: '/console/runtime',
  error: '/console/errors',
  file: '/console/files',
  global: '/console/global',
  storage: '/console/storages',
  oidc: '/console/oidc',
  user: '/console/users',
  userProfile: '/console/user-profile',
  userSecurity: '/console/user-security',
  userPreference: '/console/user-preference',
  apiToken: '/console/api-tokens',
  notificationDelivery: '/console/notification-deliveries',
  aiAgent: '/console/ai-agents',
  aiAgentRun: '/console/ai-agents/runs',
  // 文章预览：按前台文章页的样子渲染草稿与私密文章，不套后台外壳（见 app/console/console-shell.tsx）
  postPreview: '/console/posts/preview',
  // 页面预览：同上，按前台页面的样子渲染草稿与私密页面
  pagePreview: '/console/pages/preview',
}

/** 后台的预览页（文章 / 页面）：按前台的样子渲染、不套后台外壳 */
export function isConsolePreviewPath(pathname: string): boolean {
  return pathname.startsWith(`${consolePath.postPreview}/`) || pathname.startsWith(`${consolePath.pagePreview}/`)
}

export const mainPath = {
  home: '/',
  feed: '/rss.xml',
  sitemap: '/sitemap.xml',
  archive: '/a',
  label: '/l',
  category: '/c',
  random: '/random',
  privacy: '/privacy',
  notifications: '/notifications',
  notificationSettings: '/notification-settings',
}

/**
 * 获取文章的前台 URL，优先使用 slug，没有则使用 id；私密文章与草稿不在前台出现，用 getPostPreviewUrl
 * @param options Object containing post
 * @param options.post 文章对象，必须包含 slug 或 id 属性
 * @returns string
 */
export function getPostUrl<T extends { slug?: string | null, id?: string | number | null }>({
  post,
}: {
  post: T
}): string {
  const key = post.slug || post.id
  if (key == null) {
    throw new Error('toPostUrl: object must contain slug or id')
  }
  return `/p/${String(key)}`
}

/** 后台的文章预览（草稿与私密文章，仅作者本人与管理员）：用 id，编辑中改了 slug 也不受影响 */
export function getPostPreviewUrl<T extends { id: string | number }>(post: T): string {
  return `${consolePath.postPreview}/${String(post.id)}`
}

/** 在后台查看文章：私密文章或尚未首次发布的草稿前台 404，转到后台预览；公开已发布文章打开前台文章页 */
export function getPostViewUrl<T extends { slug?: string | null, id: string | number, isPrivate?: boolean, isDraft?: boolean }>(post: T): string {
  return post.isPrivate || post.isDraft ? getPostPreviewUrl(post) : getPostUrl({ post })
}

/*
 * 文章分享图：地址带上更新时间作为版本号，文章改动后地址随之变化，
 * 因此分享图接口可以放心长缓存，也不会出现「文章改了但分享图还是旧的」
 */
export function getPostShareImageUrl<
  T extends { slug?: string | null, id?: string | number | null, updatedAt?: string | null },
>(
  post: T,
): string {
  const url = `${getPostUrl({ post })}/share-image`
  const version = post.updatedAt ? Date.parse(post.updatedAt) : Number.NaN
  return Number.isNaN(version) ? url : `${url}?v=${version}`
}

export function getPostEditUrl<T extends { slug?: string | null, id?: string | number | null }>(
  post: T,
): string {
  const key = post.slug || post.id
  if (key == null) {
    throw new Error('toEditUrl: object must contain slug or id')
  }
  return `/console/posts/edit/${String(key)}`
}

/** 用户主页的内容标签，同时是 URL hash（/u/leo_dev#comments） */
export const USER_TABS = ['posts', 'comments', 'likes'] as const
export type UserTab = typeof USER_TABS[number]

/**
 * 获取用户主页地址
 * @param user 用户对象，至少包含 username
 * @param tab 要直接打开的内容标签，默认「文章」不带 hash；
 *           从评论区点进去带 #comments，从文章作者点进去就是文章（默认）
 */
export function getUserUrl<T extends { username: string }>(user: T, tab?: UserTab): string {
  return `/u/${user.username}${tab && tab !== 'posts' ? `#${tab}` : ''}`
}

export function getCategoryUrl<T extends { slug: string }>(category: T): string {
  return `/c/${category.slug}`
}

export function getLabelUrl<T extends { slug: string, name: string }>(label: T): string {
  return `/?label=${label.slug || label.name}`
}

export function getPageUrl<T extends { slug?: string | null, id?: string | number | null }>(page: T): string {
  const key = page.slug || page.id
  if (key == null) {
    throw new Error('getPageUrl: object must contain slug or id')
  }
  return `/page/${String(key)}`
}

/** 后台的页面预览（草稿与私密页面，仅作者本人与管理员）：用 id，编辑中改了 slug 也不受影响 */
export function getPagePreviewUrl<T extends { id: string | number }>(page: T): string {
  return `${consolePath.pagePreview}/${String(page.id)}`
}

/** 在后台查看页面：私密页面前台 404，转到后台预览；公开页面打开前台页面 */
export function getPageViewUrl<T extends { slug?: string | null, id: string | number, isPrivate?: boolean }>(page: T): string {
  return page.isPrivate ? getPagePreviewUrl(page) : getPageUrl(page)
}

/** 在后台查看评论 / 访问所在的文章或页面：私密的（后台接口带 isPrivate）转到后台预览，公开的打开前台 */
export function getTargetViewUrl<T extends { type: string, id: string | number, slug?: string | null, isPrivate?: boolean }>(target: T): string {
  return target.type === 'page' ? getPageViewUrl(target) : getPostViewUrl(target)
}

/**
 * 评论深链：在文章 / 独立页面的地址后带上 ?comment=<id>，打开后由评论组件定位并高亮那条评论
 * 通知中心与用户主页的评论列表共用这套约定
 */
export function withCommentAnchor(url: string, commentId?: number | null): string {
  if (!commentId)
    return url
  return `${url}${url.includes('?') ? '&' : '?'}comment=${commentId}`
}

export function getPageEditUrl<T extends { slug?: string | null, id?: string | number | null, kind?: string }>(page: T): string {
  // HTML 页面没有正文，编辑页为静态文件包的上传与版本管理
  if (page.kind === 'html' && page.id)
    return `/console/pages/html/${String(page.id)}`
  const key = page.slug || page.id
  if (key == null) {
    throw new Error('getPageEditUrl: object must contain slug or id')
  }
  return `/console/pages/edit/${String(key)}`
}
