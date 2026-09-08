import type { NextConfig } from 'next';

/**
 * Origins allowed to embed this app. The portfolio hub is served from GitHub
 * Pages at the account root, and every project page shares that origin.
 */
const EMBED_ORIGINS = ["'self'", 'https://wyattlindsey.github.io'];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            // Without this the browser default is to allow any site to frame
            // the app. Naming the hub keeps the portfolio embed working while
            // refusing everyone else -- an AI endpoint framed by a stranger's
            // page is their traffic on our budget.
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${EMBED_ORIGINS.join(' ')};`,
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
