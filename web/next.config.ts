import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { BACKEND_URL } from '@/api/client'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**', port: '', pathname: '/**' },
      { protocol: 'http', hostname: '**', port: '', pathname: '/**' }
    ],
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
        permanent: true
      },
      {
        source: '/rss',
        destination: '/rss.xml',
        permanent: true
      },
      {
        source: '/feed.xml',
        destination: '/rss.xml',
        permanent: true
      },
    ]
  }
}
const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
