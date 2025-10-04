export const consolePath = {
  category : "/console/categories",
  dashboard: "/console",
  label: "/console/labels",
  post: "/console/posts",
  comment: "/console/comments",
  file: "/console/files",
  global: "/console/global",
  storage: "/console/storages",
  oidc: "/console/oidc",
  user: "/console/users",
  userProfile: "/console/user-profile",
  userSecurity: "/console/user-security",
  userPreference: "/console/user-preference",
}

export const mainPath = {
  home: "/",
  feed: "/rss.xml",
  sitemap: "/sitemap.xml",
  archive: "/archive",
  label: "/labels",
  category: "/categories",
  random: "/random",
}

export function getPostUrl<T extends { slug?: string | null; id?: string | number | null }>(
  post: T
): string {
  const key = post.slug || post.id;
  if (key == null) {
    throw new Error('toPostUrl: object must contain slug or id')
  }
  return `/p/${String(key)}`
}

export function getUserUrl<T extends { username: string }>(user: T): string {
  return `/u/${user.username}`;
}

export function getCategoryUrl<T extends { slug: string }>(category: T): string {
  return `/c/${category.slug}`;
}

export function getLabelUrl<T extends { slug: string, name: string }>(label: T): string {
  return `/?label=${label.slug || label.name}`;
}