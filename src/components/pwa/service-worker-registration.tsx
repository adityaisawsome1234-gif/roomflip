'use client'

import { useEffect } from 'react'

const SERVICE_WORKER_URL = '/sw.js'
/** Must match CACHE_PREFIX in public/sw.js. */
const SERVICE_WORKER_CACHE_PREFIX = 'pwa-'

/**
 * Registers the service worker (public/sw.js) in production builds. Mounted
 * once from the root layout. Renders nothing.
 *
 * In development the worker is not registered, and one left over from an
 * earlier production run on this origin is removed along with its caches, so
 * it cannot serve stale build files and break hot reload.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      void removeServiceWorker()
      return
    }

    // Wait for the page to finish loading so registration never competes with
    // the first paint for the network.
    if (document.readyState === 'complete') {
      void registerServiceWorker()
      return
    }
    const onLoad = () => void registerServiceWorker()
    window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}

async function registerServiceWorker() {
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: '/',
      // Check the network for a new worker on every visit instead of trusting the HTTP cache.
      updateViaCache: 'none',
    })
  } catch {
    // The app works without a service worker. It only loses the offline page.
  }
}

async function removeServiceWorker() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))

    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith(SERVICE_WORKER_CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      )
    }
  } catch {
    // Nothing to clean up, or storage is unavailable (private browsing). Either is fine.
  }
}
