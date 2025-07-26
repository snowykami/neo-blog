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
}
const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
