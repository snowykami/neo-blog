import process from 'node:process'
import { notFound } from 'next/navigation'

/**
 * 服务端跨请求缓存（'use cache' 的取数结果，以及用到它们的页面缓存）的失效标签，与后端 internal/repo/cache_tag.go 一致：
 * 后端数据变化时换标签的版本号，web/cache-tag-versions.mjs 每隔几秒轮询一次，版本变了就让带这个标签的缓存条目失效
 * （取数结果见 web/use-cache-handler.mjs，页面见 web/cache-handler.mjs），下次访问重新取数、重新生成页面。
 * 页面条目的标签由 Next 从页面里用到的 'use cache' 汇总而来，不用另外声明。
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
  /**
   * 不存在的内容（404）：任何人都能随手拼出无数个不存在的地址，缓存它们会让条目（Redis / 文件系统）无限增长。
   * 取数函数在内容不存在时打上这个标签再返回 null，带这个标签的取数结果与页面都不写进缓存（见 web/use-cache-handler.mjs、
   * web/cache-handler.mjs），每次照常向后端确认；本次渲染内照常使用
   */
  NoStore: 'neo-nostore',
} as const

/**
 * generateStaticParams 返回的占位参数：Cache Components 要求每个带 generateStaticParams 的动态段至少返回一个参数，
 * 但镜像构建时连不上后端，构建期预渲染只能把兜底内容固化进页面。根布局的 [locale] 只返回这个占位值（不是任何语言，根布局直接 404），
 * 真实的语言、文章、用户都不在构建期生成：每个地址第一次被访问时用真实数据生成并缓存（与改前 generateStaticParams 返回空数组相同）。
 * 嵌套的动态段（文章、用户、页面）也返回它，Next 才会给每个地址单独存一份页面缓存（ISR），否则每次都按请求渲染
 */
export const BUILD_PLACEHOLDER_PARAM = '_'

/**
 * 构建期不访问后端：构建期只会预渲染占位参数的页面（见 BUILD_PLACEHOLDER_PARAM），它们一律 404。
 * 根布局判定 404 时，同一棵树里的页面、generateMetadata 仍会并行执行，所以每个服务端取数入口都要先调用这里，
 * 否则构建会因为连不上后端而失败（或者把兜底内容预渲染进去）
 */
export function skipBackendAtBuild(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build')
    notFound()
}
