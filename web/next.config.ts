import type { NextConfig } from 'next'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import createNextIntlPlugin from 'next-intl/plugin'
import { IMAGE_OPTIMIZE_HOSTS } from '@/utils/common/image'

// motion/react 的入口写成 `import * as fm from 'framer-motion'` + `export *` + `const motion = fm.motion`：命名空间导入让 Turbopack
// 摇不掉任何导出，只用 LazyMotion + m 也会把 motion 组件连同全部动画特性（约 133 KB）打进首屏。它的导出与 framer-motion 完全相同，
// 这里把 motion/react 直接指到 motion 自己依赖的那份 framer-motion（同一份文件，不新增依赖），摇树后首屏只剩 m 组件，
// 动画特性由 LazyMotion 按需加载（见 src/lib/motion）。路径按 web 目录解析（同 cacheHandler），pnpm 下为 .pnpm 里的真实目录
const requireFromMotion = createRequire(createRequire(path.join(process.cwd(), 'package.json')).resolve('motion/package.json'))
const framerMotionDir = path.relative(process.cwd(), path.dirname(requireFromMotion.resolve('framer-motion/package.json')))

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    resolveAlias: {
      'motion/react': `./${framerMotionDir}`,
    },
  },
  // 生成浏览器代码的 source map，供错误报告还原调用栈；构建后由 scripts/collect-sourcemaps.mjs 移出公开目录，不对外提供
  productionBrowserSourceMaps: true,
  // 增量缓存（ISR 页面与 unstable_cache 的取数结果）：按后端的缓存标签版本号失效；配置 REDIS_URL 时存进 Redis、多个副本共用，
  // 否则沿用 Next 自带的文件系统缓存（见 cache-handler.mjs）。在 web 目录下构建与启动，路径按当前目录解析
  cacheHandler: path.join(process.cwd(), 'cache-handler.mjs'),
  // ISR 页面过了 revalidate 之后最多再按旧内容提供多久（默认一年）：超过 1 小时没人访问的页面，下次访问先重新生成再返回，
  // 而不是先给旧页面。响应头随之变为 s-maxage=<revalidate>, stale-while-revalidate=<3600 - revalidate>，CDN 同样受这个上限约束。
  // 后端修改会按缓存标签让页面立即失效（见 cache-handler.mjs），这里兜住轮询失败、CDN 上存着的旧页面（如已改为私密的文章）
  expireTime: 3600,
  experimental: {
    // 根布局在 [locale] 段下，全站兜底的 404 由 app/global-not-found.tsx 提供（见该文件）
    globalNotFound: true,
    // 前台链接悬停 / 按下时把预取升级为完整预取（i18n/navigation.tsx 的 Link 默认开启 unstable_dynamicOnHover），点击即开
    dynamicOnHover: true,
    // 客户端路由缓存：完整预取的结果与 loading 骨架保留 60 秒（与文章页 revalidate 对齐，默认 5 分钟）；
    // 访问过的动态页面 30 秒内再点链接回去直接用缓存（默认 0，每次都重新请求）。页面已对所有人一致，缓存不会串号
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
  images: {
    // 只优化白名单内的 https 图床域名，保持 Next 默认的私网地址拦截，避免 /_next/image 被用作 SSRF 跳板
    // 站内文件使用相对路径（/api/v1/...），经 app/api/v1 路由转发到后端，不受此限制；其余外链由 SafeImage 交给浏览器直接加载
    remotePatterns: IMAGE_OPTIMIZE_HOSTS.map(hostname => ({ protocol: 'https', hostname, port: '', pathname: '/**' })),
  },
  async headers() {
    return [
      // /_next/static 不用在这里配：生产环境 Next 自己就会给它加 `public, max-age=31536000, immutable`（文档说明不可覆盖），
      // 开发环境则有意用 no-cache 让改动生效；在这里写反而会让开发时的 chunk 被浏览器长期缓存
      // 文章网页字体（scripts/gen-webfonts.mjs 生成）：分片目录带字体包版本号，可以长期缓存；字体 CSS 地址固定，缓存一天
      {
        source: '/fonts/:font/:version/:file',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/:file',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/feed',
        destination: '/rss.xml',
        permanent: true,
      },
      {
        source: '/rss',
        destination: '/rss.xml',
        permanent: true,
      },
      {
        source: '/feed.xml',
        destination: '/rss.xml',
        permanent: true,
      },
    ]
  },
}
const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
