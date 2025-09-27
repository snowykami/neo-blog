import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { BACKEND_URL } from '@/api/client'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.gravatar.com',
        port: '',
        pathname: '/avatar/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.liteyuki.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pass.liteyuki.org',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
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
