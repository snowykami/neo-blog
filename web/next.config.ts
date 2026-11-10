import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { IMAGE_OPTIMIZE_HOSTS } from '@/utils/common/image'

const nextConfig: NextConfig = {
  output: 'standalone',
  // 生成浏览器代码的 source map，供错误报告还原调用栈；构建后由 scripts/collect-sourcemaps.mjs 移出公开目录，不对外提供
  productionBrowserSourceMaps: true,
  images: {
    // 只优化白名单内的 https 图床域名，保持 Next 默认的私网地址拦截，避免 /_next/image 被用作 SSRF 跳板
    // 站内文件使用相对路径（/api/v1/...），经 app/api/v1 路由转发到后端，不受此限制；其余外链由 SafeImage 交给浏览器直接加载
    remotePatterns: IMAGE_OPTIMIZE_HOSTS.map(hostname => ({ protocol: 'https', hostname, port: '', pathname: '/**' })),
  },
  async headers() {
    return [
      // 文件名带构建 hash，内容不会变：让浏览器/CDN 长期缓存（不设 immutable 的话回访仍会回源校验）
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
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
