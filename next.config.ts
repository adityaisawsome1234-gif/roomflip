import type { NextConfig } from 'next'

/**
 * Sent with every response. There is no Content-Security-Policy yet: a useful
 * one needs a per-request nonce threaded through the proxy and the root layout.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app is never embedded in another site.
  { key: 'X-Frame-Options', value: 'DENY' },
  // The camera is for taking a room photo. Nothing else is used.
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), browsing-topics=()',
  },
]

const serviceWorkerHeaders = [
  { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
  // Browsers must always fetch the newest worker, never a cached copy.
  { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
  { key: 'Service-Worker-Allowed', value: '/' },
]

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  // Watermarks and reel captions are drawn from a bundled font (serverless hosts have
  // no system fonts). Files read at runtime are not traced automatically, so include them.
  outputFileTracingIncludes: {
    '/*': ['./assets/fonts/**/*'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: serviceWorkerHeaders },
    ]
  },
}

export default nextConfig
