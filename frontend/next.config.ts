import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  images: { unoptimized: true },
  // 최근 30일 전체 전적을 Riot 호출 제한에 맞춰 수집할 시간을 확보합니다.
  experimental: { proxyTimeout: 600000 },

  // Next.js에서 Express 백엔드로 API 요청 전달
  async rewrites() {
    const backend = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },

  allowedDevOrigins: (process.env.DEV_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
};

export default nextConfig;
