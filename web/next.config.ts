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

// 前端版本：构建参数 APP_VERSION（commit）注入的 NEXT_PUBLIC_APP_VERSION；没传时（如 Luna 构建）按构建时间生成一个，保证每次构建都不同。
// 已打开的页面据此发现新部署（提示刷新、滚动更新期间版本错位时自动刷新，见 utils/client/chunk-error.ts），错误报告也按它区分版本
// 写回环境变量：构建时配置会在多个工作进程里各加载一次，子进程继承这个值，各处拿到的是同一个版本
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || `build-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
process.env.NEXT_PUBLIC_APP_VERSION = appVersion
// 构建时间（毫秒）：已打开的页面据此判断服务器上的版本是不是更新的（滚动更新期间可能打到旧实例，只比「不同」会被刷回旧版本）
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME?.trim() || String(Date.now())
process.env.NEXT_PUBLIC_BUILD_TIME = buildTime

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  // Cache Components：页面默认按请求渲染，用 'use cache' + cacheLife + cacheTag 声明哪些数据 / 组件跨请求缓存（取代路由段的
  // dynamic、revalidate 与 unstable_cache），每个路由先预渲染出静态外壳（App Shell），读地址参数的部分在 Suspense 里流式补上。
  // 局部预取（partialPrefetching）：链接进入视口时只预取所在路由共用的 App Shell（同一个路由的所有链接共用一份），
  // 悬停 / 按下时升级为按链接预取（dynamicOnHover，见下），连同按地址参数缓存的正文一起取下来
  cacheComponents: true,
  partialPrefetching: true,
  // 'use cache' 的缓存时长（秒）。stale 是浏览器路由缓存的时长，至少 300 的内容才会进 App Shell（见 cacheLife 文档的 Prerendering behavior）；
  // expire 不小于 300 才会被预渲染，不超过 expireTime。revalidate 只是兜底：后端修改会按缓存标签版本号让条目立即失效（见 cache-handler.mjs）
  cacheLife: {
    // 站点配置、分类 / 标签列表、首页与归档的默认列表：所有页面的外壳都用到，30 秒后按 stale-while-revalidate 在后台刷新（同改前根布局的 revalidate = 30）
    site: { stale: 300, revalidate: 30, expire: 3600 },
    // 按地址取的单条内容（文章、页面、用户）：浏览器缓存 60 秒（同改前 staleTimes.static），不进 App Shell，悬停时按链接预取
    detail: { stale: 60, revalidate: 60, expire: 3600 },
    // 节日 / 季节主题：只按日期变化，10 分钟算一次（浏览器挂载后按本机日期复核，见 themes/active-theme.server.ts）
    theme: { stale: 300, revalidate: 600, expire: 3600 },
  },
  // 'use cache' 的存储：配置 REDIS_URL 时存 Redis、多个副本共用，否则在进程内存里；失效同样按后端的缓存标签版本号（见 use-cache-handler.mjs）
  cacheHandlers: {
    default: path.join(process.cwd(), 'use-cache-handler.mjs'),
  },
  turbopack: {
    resolveAlias: {
      'motion/react': `./${framerMotionDir}`,
    },
  },
  // 生成浏览器代码的 source map，供错误报告还原调用栈；构建后由 scripts/collect-sourcemaps.mjs 移出公开目录，不对外提供
  productionBrowserSourceMaps: true,
  // 页面缓存（ISR：每个地址生成一次的完整页面，以及各路由的 App Shell）：按后端的缓存标签版本号失效；配置 REDIS_URL 时存进 Redis、
  // 多个副本共用，否则沿用 Next 自带的文件系统缓存（见 cache-handler.mjs）。在 web 目录下构建与启动，路径按当前目录解析
  cacheHandler: path.join(process.cwd(), 'cache-handler.mjs'),
  // 页面缓存过了 revalidate 之后最多再按旧内容提供多久（默认一年）：超过 1 小时没人访问的页面，下次访问先重新生成再返回，
  // 而不是先给旧页面；CDN 同样受这个上限约束。后端修改会按缓存标签让页面立即失效（见 cache-handler.mjs），
  // 这里兜住轮询失败、CDN 上存着的旧页面（如已改为私密的文章）
  expireTime: 3600,
  experimental: {
    // 根布局在 [locale] 段下，全站兜底的 404 由 app/global-not-found.tsx 提供（见该文件）
    globalNotFound: true,
    // 前台链接悬停 / 按下时把预取升级为按链接预取（i18n/navigation.tsx 的 Link 默认开启 unstable_dynamicOnHover）：
    // 局部预取下等同于文档里「悬停时 prefetch={true}」的写法，连同按地址缓存的正文一起取下来，点击即开；
    // 只进入视口的链接只取所在路由的 App Shell（同一路由共用一份），键盘 / 没悬停到的点击立刻出外壳与骨架
    dynamicOnHover: true,
    // 访问过的页面 30 秒内再点链接回去直接用浏览器里的缓存（默认 0，每次都重新请求）。页面已对所有人一致，缓存不会串号。
    // 预取内容的缓存时长由 cacheLife 的 stale 决定（见上），不再设 static（它会改写 default 配置的 stale）
    staleTimes: {
      dynamic: 30,
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
