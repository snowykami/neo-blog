import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { BACKEND_URL } from '@/api/client'
import { IMAGE_OPTIMIZE_HOSTS } from '@/utils/common/image'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    // 只优化白名单内的 https 图床域名，保持 Next 默认的私网地址拦截，避免 /_next/image 被用作 SSRF 跳板
    // 站内文件使用相对路径（/api/v1/...），经 rewrites 内部转发，不受此限制；其余外链由 SafeImage 交给浏览器直接加载
    remotePatterns: IMAGE_OPTIMIZE_HOSTS.map(hostname => ({ protocol: 'https', hostname, port: '', pathname: '/**' })),
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${BACKEND_URL}/api/v1/:path*`,
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
