import type { MetadataRoute } from 'next'
import { ROUTES, SITE } from '@/lib/config/site'

/**
 * Web app manifest, served at /manifest.webmanifest. It is what makes the site
 * installable to a phone's home screen.
 *
 * The icon files are written by scripts/generate-icons.mjs. The same three
 * paths are precached by public/sw.js: keep the two lists in step.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    // A fixed id keeps an installed app the same app if start_url ever changes.
    id: '/',
    start_url: ROUTES.app,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // The splash screen and the system bars use the light page color.
    background_color: SITE.themeColor.light,
    theme_color: SITE.themeColor.light,
    categories: ['lifestyle', 'photo'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'New restyle',
        url: ROUTES.app,
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  }
}
