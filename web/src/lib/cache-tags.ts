/**
 * 服务端跨请求缓存（unstable_cache 的取数结果，以及用到它们的 ISR 页面）的失效标签，与后端 internal/repo/cache_tag.go 一致：
 * 后端数据变化时换标签的版本号，web/cache-handler.mjs 每隔几秒轮询一次，版本变了就让带这个标签的缓存条目失效，
 * 下次访问重新取数、重新生成页面。页面条目的标签由 Next 从页面里用到的 unstable_cache 汇总而来，不用另外声明。
 * 粒度只到数据种类（改一篇文章，全部文章页在下次访问时各重新生成一次），后端接口因此不会透露私密文章的 id 或 slug
 */
export const CacheTag = {
  /** 文章、分类、标签 */
  Posts: 'posts',
  /** 自定义页面 */
  Pages: 'pages',
  /** 用户资料 */
  Users: 'users',
  /** 站点配置 */
  Site: 'site',
} as const

/**
 * 按 id / slug 取的单条内容（文章、页面、用户）的跨请求缓存时长（秒）：后端修改会通过标签让缓存立即失效，
 * 这里只是轮询失败（后端暂时连不上）时的兜底，与文章页的 revalidate 一致
 */
export const DETAIL_REVALIDATE_SECONDS = 60

/**
 * 不存在的内容（404）不进跨请求缓存：任何人都能随手拼出无数个不存在的地址，缓存它们会让条目（文件系统模式下是磁盘文件）无限增长。
 * 在 unstable_cache 的取数函数里抛出它（抛出的错误不会被缓存），外面用 nullIfNotFound 换回 null；
 * 对应的 404 页面也不缓存（见 web/cache-handler.mjs），每次照常向后端确认，与改为 ISR 之前相同
 */
export class UncachedNotFound extends Error {
  constructor() {
    super('not found (not cached)')
    this.name = 'UncachedNotFound'
  }
}

/** 把取数函数抛出的 UncachedNotFound 换回 null，其余错误照常抛出 */
export function nullIfNotFound(error: unknown): null {
  if (error instanceof UncachedNotFound)
    return null
  throw error
}
