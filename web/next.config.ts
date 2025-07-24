import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      const backendUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8888")
      console.log("Using development API base URL:", backendUrl);
      return [
        {
          source: '/api/:path*',
          destination: backendUrl + '/api/:path*',
        },
      ]
    }
};

export default nextConfig;
