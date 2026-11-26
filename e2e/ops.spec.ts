import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import Stripe from 'stripe'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

/**
 * Analytics, rate limits and the admin page. Analytics events are captured by
 * a local stand-in for PostHog on the port POSTHOG_HOST points at.
 */

test.describe.configure({ mode: 'serial' })
test.skip(!!process.env.E2E_PROD, 'Needs uploads and stripe-mock: development only')
test.skip(({ browserName }) => browserName !== 'chromium')

interface Captured {
  event: string
  distinct_id: string
  properties: Record<string, unknown>
  uuid?: string
}

const captured: Captured[] = []
let collector: Server | null = null

test.beforeAll(async () => {
  const port = Number(new URL(process.env.POSTHOG_HOST ?? 'http://localhost:4318').port)
  collector = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        captured.push(JSON.parse(body))
      } catch {
        // ignore
      }
      res.writeHead(200).end('{"status":1}')
    })
  })
  await new Promise<void>((resolve, reject) => {
    collector!.once('error', reject)
    collector!.listen(port, resolve)
  })
})

test.afterAll(async () => {
  await new Promise((resolve) => collector?.close(resolve))
})

async function userIdFor(email: string) {
  const { data } = await adminClient().from('profiles').select('id').eq('email', email).single()
  return data!.id as string
}

async function finishRender(page: Page, roomId: string) {
  const { renderId } = await (
    await page.request.post('/api/renders', {
      data: { tier: 'preview', roomId, choice: { mode: 'style', preset: 'scandinavian' } },
    })
  ).json()
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/renders/${renderId}`)).json()).render.status,
      { timeout: 20_000 },
    )
    .toBe('succeeded')
  return renderId as string
}

test('the six product events reach analytics, keyed by user id', async ({ page }) => {
  const email = uniqueEmail('events')
  await signInAs(page, email)
  const userId = await userIdFor(email)

  const photo = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#9daab4' },
  })
    .jpeg()
    .toBuffer()
  const { room } = await (
    await page.request.post('/api/rooms', {
      multipart: { photo: { name: 'r.jpg', mimeType: 'image/jpeg', buffer: photo } },
    })
  ).json()
  const first = await finishRender(page, room.id)
  await page.request.post(`/api/renders/${first}/export`, { data: { kind: 'reel' } })
  await finishRender(page, room.id)
  // The last free render, from the app, so the paywall opens.
  await page.goto(`/app/room/${room.id}`)
  await page.getByRole('button', { name: 'Restyle my room' }).click()
  await expect(page.getByRole('dialog', { name: 'Love it? Keep going.' })).toBeVisible({
    timeout: 25_000,
  })

  // A purchase, through a signed webhook.
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${randomUUID()}`,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: userId,
        metadata: { user_id: userId, item: 'pack_20' },
        amount_total: 499,
        currency: 'usd',
      },
    },
  })
  await page.request.post('/api/webhooks/stripe', {
    data: payload,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      }),
    },
  })

  const mine = () => captured.filter((e) => e.distinct_id === userId).map((e) => e.event)
  await expect
    .poll(() => new Set(mine()), { timeout: 15_000 })
    .toEqual(
      new Set([
        'signup',
        'render_started',
        'render_completed',
        'export_reel',
        'paywall_view',
        'purchase',
      ]),
    )

  expect(mine().filter((e) => e === 'signup')).toHaveLength(1)
  expect(mine().filter((e) => e === 'render_started')).toHaveLength(3)
  const purchase = captured.find((e) => e.distinct_id === userId && e.event === 'purchase')!
  expect(purchase.properties).toMatchObject({ kind: 'pack', item: 'pack_20', amount: 4.99 })
  expect(purchase.uuid).toBeTruthy()
  // Nothing personal goes to analytics.
  expect(JSON.stringify(captured.filter((e) => e.distinct_id === userId))).not.toContain(email)
})

test('too many render requests are refused with 429 and Retry-After', async ({ page }) => {
  await signInAs(page, uniqueEmail('ratelimit'))
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer()
  const { room } = await (
    await page.request.post('/api/rooms', {
      multipart: { photo: { name: 'r.jpg', mimeType: 'image/jpeg', buffer: photo } },
    })
  ).json()
  const statuses: number[] = []
  for (let i = 0; i < 21; i++) {
    const response = await page.request.post('/api/renders', {
      data: { tier: 'preview', roomId: room.id, choice: { mode: 'style', preset: 'boho' } },
    })
    statuses.push(response.status())
    if (response.status() === 429) {
      expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0)
    }
  }
  // 3 free renders, then out of credits, then the limit.
  expect(statuses.slice(0, 3)).toEqual([202, 202, 202])
  expect(statuses.slice(3, 20).every((s) => s === 402)).toBe(true)
  expect(statuses[20]).toBe(429)
})

test('the admin page is for admins only', async ({ page, browser }) => {
  await signInAs(page, uniqueEmail('notadmin'))
  await page.goto('/admin')
  await expect(page.getByText('This page could not be found.')).toBeVisible()

  const context = await browser.newContext()
  const admin = await context.newPage()
  await signInAs(admin, process.env.ADMIN_EMAILS!.split(',')[0])
  await admin.goto('/admin?days=30')
  await expect(admin.getByRole('heading', { name: 'Last 30 days' })).toBeVisible()
  for (const caption of [
    'Cost per render, by model',
    'Revenue, by product',
    'Users',
    'Recent renders',
  ]) {
    await expect(admin.getByRole('heading', { name: caption })).toBeVisible()
  }
  const totals = admin.getByRole('region', { name: 'Totals' })
  for (const label of ['Revenue', 'Model spend', 'Gross margin', 'Renders', 'New users']) {
    await expect(totals.getByText(label, { exact: true })).toBeVisible()
  }
  // Per-model cost rows, with the configured price next to the measured one.
  await expect(admin.getByRole('cell', { name: 'Mock (no provider call)' }).first()).toBeVisible()

  await admin.getByLabel('Search users by email').fill('ratelimit')
  await admin.getByRole('button', { name: 'Search' }).click()
  await expect(admin).toHaveURL(/q=ratelimit/)
  await expect(admin.getByRole('cell', { name: /ratelimit-/ }).first()).toBeVisible()
  await context.close()
})
