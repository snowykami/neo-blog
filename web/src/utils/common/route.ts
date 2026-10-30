export const consolePath = {
  category: '/console/categories',
  dashboard: '/console',
  label: '/console/labels',
  post: '/console/posts',
  page: '/console/pages',
  comment: '/console/comments',
  lyricEffect: '/console/lyric-effects',
  visit: '/console/visits',
  file: '/console/files',
  global: '/console/global',
  storage: '/console/storages',
  oidc: '/console/oidc',
  user: '/console/users',
  userProfile: '/console/user-profile',
  userSecurity: '/console/user-security',
  userPreference: '/console/user-preference',
  apiToken: '/console/api-tokens',
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
}

/**
 * 获取文章的 URL优先使用 slug，没有则使用 id
 * @param options Object containing post and optional type
 * @param options.post 文章对象，必须包含 slug 或 id 属性
 * @param options.type 可选的文章类型，如 'draft'
 * @returns string
 */
export function getPostUrl<T extends { slug?: string | null, id?: string | number | null }>({
  post,
  type,
}: {
  post: T
  type?: 'draft'
}): string {
  const key = post.slug || post.id
  if (key == null) {
    throw new Error('toPostUrl: object must contain slug or id')
  }
  return `/p/${String(key)}${type ? `?type=${type}` : ''}`
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

export function getUserUrl<T extends { username: string }>(user: T): string {
  return `/u/${user.username}`
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
