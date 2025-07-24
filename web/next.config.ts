
import { BACKEND_URL } from "@/api/client";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
      const backendUrl = BACKEND_URL
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
