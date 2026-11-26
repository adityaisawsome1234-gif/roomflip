import { expect, test, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import { ROUTES, SITE } from '../src/lib/config/site'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

/**
 * The installable shell: manifest, icons, service worker, offline page,
 * security headers, and the signed-in app's tab bar.
 *
 * The service worker itself only runs in production builds. Its test is
 * skipped unless E2E_PROD is set:
 *
 *   npm run build && npm run start
 *   E2E_PROD=1 npx playwright test e2e/pwa.spec.ts
 */

const PHONE = { width: 390, height: 844 }
/** A phone screen too short for the pages to fit, so they have to scroll. */
const SHORT_PHONE = { width: 390, height: 480 }
const DESKTOP = { width: 1280, height: 800 }

const MIN_TOUCH_TARGET = 44
const TAB_NAMES = ['Create', 'My rooms', 'Account']
const OFFLINE_HEADING = "You're offline"

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), browsing-topics=()',
}

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

// --- Test users ---------------------------------------------------------------

const createdEmails: string[] = []

/** Sign in as a brand-new user. Every user made here is deleted when the file finishes. */
async function signIn(page: Page): Promise<void> {
  const email = uniqueEmail('pwa')
  createdEmails.push(email)
  await signInAs(page, email)
}

test.afterAll(async () => {
  if (createdEmails.length === 0) return
  const admin = adminClient()
  const { data, error } = await admin.from('profiles').select('id').in('email', createdEmails)
  if (error) throw new Error(`Could not look up test users to delete: ${error.message}`)
  for (const { id } of data ?? []) {
    await admin.auth.admin.deleteUser(id)
  }
})

// --- Helpers ------------------------------------------------------------------

/**
 * In development Next.js floats a dev tools badge over the bottom-left corner,
 * on top of the first tab. It is not part of the app, so keep it out of the way.
 */
async function hideDevTools(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important }'
      document.head.append(style)
    })
  })
}

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' })
}

function tab(page: Page, name: string): Locator {
  return tabBar(page).getByRole('link', { name, exact: true })
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Element has no bounding box: it is not visible')
  return box
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(innerWidth)
}

/** Scroll to the end and check that the last thing on the page sits above the tab bar. */
async function expectPageEndsAboveTabBar(page: Page): Promise<void> {
  const { lastBottom, tabBarTop } = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const main = document.querySelector('main')
    const bar = document.querySelector('nav[aria-label="Main"]')
    if (!main || !bar) throw new Error('The app shell is missing its <main> or its tab bar')
    let last: Element = main
    while (last.lastElementChild) last = last.lastElementChild
    return {
      lastBottom: last.getBoundingClientRect().bottom,
      tabBarTop: bar.getBoundingClientRect().top,
    }
  })
  expect(lastBottom, 'the end of the page must not sit behind the tab bar').toBeLessThanOrEqual(
    tabBarTop,
  )
}

// --- Manifest and icons -------------------------------------------------------

test('the manifest describes the app and every icon in it is a PNG of the stated size', async ({
  request,
}) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/manifest+json')

  const manifest = await response.json()
  expect(manifest).toMatchObject({
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    id: '/',
    start_url: ROUTES.app,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: SITE.themeColor.light,
    theme_color: SITE.themeColor.light,
  })
  expect(manifest.categories.length).toBeGreaterThan(0)
  expect(manifest.shortcuts).toEqual([
    expect.objectContaining({ name: 'New restyle', url: ROUTES.app }),
  ])

  const icons: ManifestIcon[] = manifest.icons
  expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ])

  const shortcutIcons: ManifestIcon[] = manifest.shortcuts.flatMap(
    (shortcut: { icons?: ManifestIcon[] }) => shortcut.icons ?? [],
  )
  for (const icon of [...icons, ...shortcutIcons]) {
    const iconResponse = await request.get(icon.src)
    expect(iconResponse.status(), icon.src).toBe(200)
    expect(iconResponse.headers()['content-type'], icon.src).toBe('image/png')
    expect(icon.type, icon.src).toBe('image/png')

    const image = sharp(await iconResponse.body())
    const { format, width, height } = await image.metadata()
    expect(format, icon.src).toBe('png')
    expect(`${width}x${height}`, icon.src).toBe(icon.sizes)

    if (icon.purpose === 'maskable') {
      // The launcher crops a maskable icon, so it needs a solid background edge to edge.
      expect((await image.stats()).isOpaque, `${icon.src} must have no transparency`).toBe(true)
    }
  }
})

test('pages link the manifest and an opaque 180px Apple touch icon', async ({ page, request }) => {
  await page.goto(ROUTES.offline)

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )

  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect(href).toBeTruthy()
  const response = await request.get(href as string)
  expect(response.status()).toBe(200)

  const image = sharp(await response.body())
  const { format, width, height } = await image.metadata()
  expect({ format, width, height }).toEqual({ format: 'png', width: 180, height: 180 })
  // iOS paints transparent pixels black.
  expect((await image.stats()).isOpaque).toBe(true)
})

// --- Service worker file ------------------------------------------------------

test('the service worker file is served as uncached JavaScript scoped to the whole site', async ({
  request,
}) => {
  const response = await request.get('/sw.js')
  expect(response.status()).toBe(200)
  expect(response.headers()).toMatchObject({
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'no-cache, no-store, must-revalidate',
    'service-worker-allowed': '/',
  })

  const source = await response.text()
  expect(source).toMatch(/const CACHE_VERSION = '[^']+'/)

  // It precaches the offline page and every icon the manifest lists.
  expect(source).toContain(`'${ROUTES.offline}'`)
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  for (const icon of manifest.icons as ManifestIcon[]) {
    expect(source, `sw.js should precache ${icon.src}`).toContain(`'${icon.src}'`)
  }
})

// --- Offline page -------------------------------------------------------------

test('the offline page renders for a signed-out visitor and its button retries', async ({
  page,
}) => {
  const response = await page.goto(ROUTES.offline)
  expect(response?.status()).toBe(200)
  // Not bounced to the login page.
  await expect(page).toHaveURL(ROUTES.offline)

  const heading = page.getByRole('heading', { level: 1, name: OFFLINE_HEADING })
  const tryAgain = page.getByRole('button', { name: 'Try again' })
  await expect(heading).toBeVisible()
  await expect(tryAgain).toBeVisible()
  expect((await boxOf(tryAgain)).height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)

  // Pressing the button loads the page again: a mark left on the old document is gone.
  await page.evaluate(() => {
    document.documentElement.dataset.beforeRetry = 'true'
  })
  await tryAgain.click()
  await page.waitForFunction(() => document.documentElement.dataset.beforeRetry === undefined)
  await expect(heading).toBeVisible()
})

// --- Signed-in app chrome -----------------------------------------------------

test.describe('signed-in app at phone width', () => {
  test.use({ viewport: PHONE })

  test.beforeEach(async ({ page }) => {
    await hideDevTools(page)
    await signIn(page)
  })

  test('the tab bar shows three tabs, marks the current one and navigates', async ({ page }) => {
    await page.goto(ROUTES.app)

    await expect(tabBar(page).getByRole('link')).toHaveText(TAB_NAMES)
    await expect(tab(page, 'Create')).toHaveAttribute('aria-current', 'page')
    await expect(tabBar(page).locator('[aria-current]')).toHaveCount(1)

    await tab(page, 'My rooms').click()
    await expect(page).toHaveURL(ROUTES.rooms)
    await expect(tab(page, 'My rooms')).toHaveAttribute('aria-current', 'page')
    // Create is current on exactly /app, not on the pages beneath it.
    await expect(tabBar(page).locator('[aria-current]')).toHaveCount(1)

    await tab(page, 'Create').click()
    await expect(page).toHaveURL(ROUTES.app)
    await expect(tab(page, 'Create')).toHaveAttribute('aria-current', 'page')

    // The account page belongs to the sign-in work, so only its address is checked here.
    await tab(page, 'Account').click()
    await expect(page).toHaveURL(ROUTES.account)
  })

  test('each tab is a full-size touch target and the three share the width', async ({ page }) => {
    await page.goto(ROUTES.app)

    const bar = await boxOf(tabBar(page))
    // Pinned to the bottom edge, edge to edge on a phone.
    expect(bar.x).toBe(0)
    expect(bar.width).toBe(PHONE.width)
    expect(bar.y + bar.height).toBe(PHONE.height)

    for (const name of TAB_NAMES) {
      const box = await boxOf(tab(page, name))
      expect(box.height, `${name} tab height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(Math.abs(box.width - bar.width / TAB_NAMES.length), `${name} tab width`).toBeLessThan(
        1,
      )
    }
  })

  test('pages do not scroll sideways and end above the tab bar', async ({ page }) => {
    for (const viewport of [PHONE, SHORT_PHONE]) {
      await page.setViewportSize(viewport)
      for (const path of [ROUTES.app, ROUTES.rooms]) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectNoHorizontalScroll(page)
        await expectPageEndsAboveTabBar(page)
      }
    }
  })
})

test.describe('signed-in app on a wide screen', () => {
  test.use({ viewport: DESKTOP })

  test('the app stays a centered phone-width column with the tab bar aligned to it', async ({
    page,
  }) => {
    await hideDevTools(page)
    await signIn(page)
    await page.goto(ROUTES.app)

    const content = await boxOf(page.getByRole('main'))
    const bar = await boxOf(tabBar(page))

    // About 28rem wide, not stretched across the window.
    expect(bar.width).toBeLessThanOrEqual(448)
    expect(bar.width).toBeGreaterThan(400)
    // Centered, and lined up with the page content.
    expect(Math.abs(bar.x + bar.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(content.x + content.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(1)
    expect(content.width).toBeLessThanOrEqual(bar.width)

    await expectNoHorizontalScroll(page)
  })
})

// --- Security headers ---------------------------------------------------------

test('security headers are sent with public and signed-in pages', async ({ page }) => {
  await signIn(page)

  for (const path of [ROUTES.home, ROUTES.app]) {
    // No redirects: the headers must be on the page's own response.
    const response = await page.request.get(path, { maxRedirects: 0 })
    expect(response.status(), path).toBe(200)
    expect(response.headers(), path).toMatchObject(SECURITY_HEADERS)
  }
})

// --- Service worker behavior (production builds only) -------------------------

test('in a production build the service worker takes control and shows the offline page', async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.E2E_PROD,
    'The service worker is only registered in production builds. Run with E2E_PROD=1 against `next start`.',
  )

  await page.goto(ROUTES.home)

  // Registration waits for the page to load. `ready` settles once a worker is
  // active, which is after it has stored the offline page.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')
  // The worker claims the page that registered it.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const scriptUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)
  expect(new URL(scriptUrl as string).pathname).toBe('/sw.js')

  await context.setOffline(true)

  // A page load with no network gets the offline page, at the address that was asked for.
  await page.goto(ROUTES.home)
  const heading = page.getByRole('heading', { level: 1, name: OFFLINE_HEADING })
  const tryAgain = page.getByRole('button', { name: 'Try again' })
  await expect(heading).toBeVisible()
  await expect(tryAgain).toBeVisible()
  await expect(page).toHaveURL(ROUTES.home)

  // Still offline: trying again loads the offline page again rather than a browser error.
  await page.evaluate(() => {
    document.documentElement.dataset.beforeRetry = 'true'
  })
  await tryAgain.click()
  await page.waitForFunction(() => document.documentElement.dataset.beforeRetry === undefined)
  await expect(heading).toBeVisible()

  // Back online, pages come from the network again. A fresh tab is used because
  // the offline page reloads itself when the connection returns.
  await context.setOffline(false)
  const freshTab = await context.newPage()
  await freshTab.goto(ROUTES.home)
  await expect(freshTab.getByRole('heading', { name: OFFLINE_HEADING })).toHaveCount(0)
  expect(await freshTab.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
})
