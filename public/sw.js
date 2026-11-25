/*
 * Service worker. Plain JavaScript on purpose: no build step, no libraries.
 *
 * It does two things:
 *   1. Shows a friendly offline page when a page load fails because there is no network.
 *   2. Keeps build assets (/_next/static/*) and the app icons (/icons/*) in a cache.
 *      Those files are immutable or content-hashed, so serving them from cache is safe.
 *
 * It deliberately does nothing else. Same-origin GET requests only, and of those:
 *   - Page loads go to the network first. Only when the network fails does the
 *     worker answer, and then only with the precached /offline page.
 *   - API routes, /auth/*, React Server Component payloads (an "rsc" header or
 *     an _rsc query parameter) and every other request are never intercepted.
 *     Neither are requests to other origins such as Supabase.
 *
 * Why so conservative: privacy. Signed-in pages are personal, and a phone or
 * laptop can be shared. If this worker cached page HTML or data, the next
 * person on the device could be shown the previous user's rooms from cache.
 * So /offline is the only document ever stored or served from cache, and it is
 * fetched without cookies so it cannot contain anything about anyone.
 *
 * Bump CACHE_VERSION when this file's caching rules, the offline page or the
 * icons change. Installed apps then drop their old caches on the next visit.
 */
const CACHE_VERSION = 'v1'

const CACHE_PREFIX = 'pwa-'
/** Written once at install: the offline page, what it needs to render, and the icons. */
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`
/** Filled as the app is used: hashed build assets. */
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`

const OFFLINE_URL = '/offline'
const ICON_URLS = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']

/** Old build assets pile up between deploys. Keep the newest ones and drop the rest. */
const STATIC_CACHE_MAX_ENTRIES = 150

/**
 * A query string never changes what a hashed file contains, and a Vary header
 * must not hide a copy that is already stored.
 */
const MATCH_ANY_VARIANT = { ignoreSearch: true, ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  // Safe to take over straight away: this worker never serves app pages from
  // cache, so a tab cannot end up with a mix of old and new code.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isNeverIntercepted(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(pageFromNetwork(request))
    return
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(assetFromCache(event))
  }

  // Everything else falls through to the browser untouched.
})

function isNeverIntercepted(request, url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    request.headers.has('rsc') ||
    url.searchParams.has('_rsc') ||
    // A cached copy is a whole file. Let the server answer requests for part of one.
    request.headers.has('range')
  )
}

async function precache() {
  const cache = await caches.open(SHELL_CACHE)

  // No cookies, so the stored page cannot be personal. No HTTP cache, so a new
  // worker version always stores the page from the current build.
  const response = await fetch(new Request(OFFLINE_URL, { credentials: 'omit', cache: 'reload' }))
  if (!response.ok || response.redirected) {
    throw new Error(`Could not precache ${OFFLINE_URL}: HTTP ${response.status}`)
  }
  const html = await response.clone().text()
  await cache.put(OFFLINE_URL, response)

  // The offline page is useless unstyled and its button needs its script, so
  // store the build assets its HTML refers to. One missing file must not stop
  // the worker from installing.
  await Promise.allSettled([...ICON_URLS, ...buildAssetUrls(html)].map((url) => cache.add(url)))
}

/** Paths of the hashed build files (scripts, styles, fonts) mentioned anywhere in a page's HTML. */
function buildAssetUrls(html) {
  const matches = html.match(/\/_next\/static\/[A-Za-z0-9_.~%@()[\]/-]+\.(?:js|css|woff2?)/g) ?? []
  return [...new Set(matches)]
}

async function deleteOldCaches() {
  const current = [SHELL_CACHE, STATIC_CACHE]
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && !current.includes(name))
      .map((name) => caches.delete(name)),
  )
}

/** Network first. The offline page is the only thing ever answered from cache. */
async function pageFromNetwork(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const offlinePage = await cache.match(OFFLINE_URL, MATCH_ANY_VARIANT)
    return offlinePage ?? Response.error()
  }
}

/** Cache first, filling the cache from the network on first use. */
async function assetFromCache(event) {
  const { request } = event

  const shell = await caches.open(SHELL_CACHE)
  const precached = await shell.match(request, MATCH_ANY_VARIANT)
  if (precached) return precached

  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request, MATCH_ANY_VARIANT)
  if (cached) return cached

  const response = await fetch(request)
  // Only complete, same-origin responses are worth keeping (not errors, not partial content).
  if (response.status === 200 && response.type === 'basic') {
    const copy = response.clone()
    event.waitUntil(
      cache
        .put(request, copy)
        .then(() => trim(cache, STATIC_CACHE_MAX_ENTRIES))
        // A full disk only means this file is fetched again next time.
        .catch(() => {}),
    )
  }
  return response
}

/** Cache keys come back oldest first, so deleting from the front drops the oldest entries. */
async function trim(cache, maxEntries) {
  const keys = await cache.keys()
  const surplus = keys.slice(0, Math.max(0, keys.length - maxEntries))
  await Promise.all(surplus.map((key) => cache.delete(key)))
}
