import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import Stripe from 'stripe'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

/**
 * Billing over HTTP. Stripe API calls go to stripe-mock (STRIPE_API_BASE in
 * .env.local); webhooks are signed locally with STRIPE_WEBHOOK_SECRET.
 *   docker run -d -p 12111:12111 stripe/stripe-mock
 */

test.skip(!process.env.STRIPE_WEBHOOK_SECRET, 'Needs the local Stripe test settings in .env.local')
test.skip(({ browserName }) => browserName !== 'chromium')

async function userIdFor(email: string): Promise<string> {
  const { data } = await adminClient().from('profiles').select('id').eq('email', email).single()
  return data!.id
}

function signed(payload: string, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret })
}

function packEvent(userId: string, sessionId = `cs_test_${randomUUID()}`) {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: userId,
        customer: 'cus_e2e',
        metadata: { user_id: userId, item: 'pack_20' },
        amount_total: 499,
        currency: 'usd',
      },
    },
  })
}

test('the Stripe webhook only accepts correctly signed events, and applies them once', async ({
  page,
}) => {
  const email = uniqueEmail('webhook')
  await signInAs(page, email)
  const userId = await userIdFor(email)
  const payload = packEvent(userId)
  const post = (headers: Record<string, string>) =>
    page.request.post('/api/webhooks/stripe', {
      data: payload,
      headers: { 'content-type': 'application/json', ...headers },
    })

  expect((await post({})).status()).toBe(400)
  expect((await post({ 'stripe-signature': signed(payload, 'whsec_wrong') })).status()).toBe(400)
  expect((await post({ 'stripe-signature': 't=1,v1=deadbeef' })).status()).toBe(400)

  const ok = await post({ 'stripe-signature': signed(payload) })
  expect(ok.status()).toBe(200)
  expect(await ok.json()).toEqual({ received: true, outcome: 'processed' })
  const again = await post({ 'stripe-signature': signed(payload) })
  expect(await again.json()).toEqual({ received: true, outcome: 'duplicate' })

  await page.goto('/app/account')
  const card = page.getByRole('region', { name: 'Renders left' })
  await expect(card).toContainText('23')
  await expect(card).toContainText('Purchased')
})

test('checkout opens for packs and plans, and refuses a second plan', async ({ page }) => {
  // Production builds ignore STRIPE_API_BASE (no stripe-mock) and refuse uploads without moderation.
  test.skip(!!process.env.E2E_PROD, 'Needs stripe-mock and uploads: development only')
  const email = uniqueEmail('checkout')
  await signInAs(page, email)

  expect(
    (await page.request.post('/api/billing/checkout', { data: { item: 'pack_9000' } })).status(),
  ).toBe(400)
  expect((await page.request.post('/api/billing/portal')).status()).toBe(404)

  const pack = await page.request.post('/api/billing/checkout', {
    data: { item: 'pack_20', returnPath: '/app' },
  })
  expect(pack.status()).toBe(200)
  expect((await pack.json()).url).toMatch(/^https:\/\//)
  const { data: customer } = await adminClient()
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', await userIdFor(email))
    .single()
  expect(customer!.stripe_customer_id).toMatch(/^cus_/)

  // With a customer on file, the portal opens.
  expect((await page.request.post('/api/billing/portal')).status()).toBe(200)

  // An active plan: a second plan is refused, a pack is still fine.
  await adminClient()
    .from('subscriptions')
    .insert({
      id: `sub_${randomUUID()}`,
      user_id: await userIdFor(email),
      plan_id: 'pro_weekly',
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })
  const second = await page.request.post('/api/billing/checkout', { data: { item: 'pro_annual' } })
  expect(second.status()).toBe(409)
  expect((await second.json()).error.code).toBe('already_subscribed')
  expect(
    (await page.request.post('/api/billing/checkout', { data: { item: 'pack_60' } })).status(),
  ).toBe(200)

  // The account tab shows the plan and a way to manage it.
  await page.goto('/app/account')
  await expect(page.getByText('Pro Weekly')).toBeVisible()
  await expect(page.getByText(/Renews on/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toBeVisible()
})

async function renderViaApi(page: Page, roomId: string) {
  const response = await page.request.post('/api/renders', {
    data: { tier: 'preview', roomId, choice: { mode: 'style', preset: 'modern' } },
  })
  const { renderId } = await response.json()
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/renders/${renderId}`)).json()).render.status,
      { timeout: 20_000 },
    )
    .toBe('succeeded')
}

test('the paywall opens right after the last free render, over the result', async ({ page }) => {
  // Production builds ignore STRIPE_API_BASE (no stripe-mock) and refuse uploads without moderation.
  test.skip(!!process.env.E2E_PROD, 'Needs stripe-mock and uploads: development only')
  await signInAs(page, uniqueEmail('paywall'))
  const photo = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#a9b4bd' },
  })
    .jpeg()
    .toBuffer()
  const { room } = await (
    await page.request.post('/api/rooms', {
      multipart: { photo: { name: 'r.jpg', mimeType: 'image/jpeg', buffer: photo } },
    })
  ).json()
  await renderViaApi(page, room.id)
  await renderViaApi(page, room.id)

  // The third and last free render, from the app.
  await page.goto(`/app/room/${room.id}`)
  await page.getByRole('button', { name: 'Restyle my room' }).click()
  await page.waitForURL(/\/app\/render\//)

  const paywall = page.getByRole('dialog', { name: 'Love it? Keep going.' })
  await expect(paywall).toBeVisible({ timeout: 25_000 })
  // The result is right there behind it.
  await expect(page.getByRole('img', { name: 'After' })).toBeVisible()
  await expect(paywall.getByRole('radio', { name: /Pro Annual/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(paywall).toContainText('$59.99 a year')
  await expect(paywall).toContainText('$6.99 a week')
  await expect(paywall).toContainText('20 for $4.99')

  // Choosing a plan hands over to Stripe Checkout.
  await page.route(/checkout\.stripe\.com/, (route) =>
    route.fulfill({ status: 200, body: 'checkout' }),
  )
  await paywall.getByRole('radio', { name: /Pro Weekly/ }).click()
  const toCheckout = page.waitForRequest(/checkout\.stripe\.com/)
  await paywall.getByRole('button', { name: 'Continue with Pro Weekly' }).click()
  await toCheckout
})

test('Escape and "Not now" close the paywall', async ({ page }) => {
  // Production builds ignore STRIPE_API_BASE (no stripe-mock) and refuse uploads without moderation.
  test.skip(!!process.env.E2E_PROD, 'Needs stripe-mock and uploads: development only')
  await signInAs(page, uniqueEmail('paywallclose'))
  const photo = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#b0a9bd' },
  })
    .jpeg()
    .toBuffer()
  const { room } = await (
    await page.request.post('/api/rooms', {
      multipart: { photo: { name: 'r.jpg', mimeType: 'image/jpeg', buffer: photo } },
    })
  ).json()
  await renderViaApi(page, room.id)
  await renderViaApi(page, room.id)
  await page.goto(`/app/room/${room.id}`)
  await page.getByRole('button', { name: 'Restyle my room' }).click()

  const paywall = page.getByRole('dialog', { name: 'Love it? Keep going.' })
  await expect(paywall).toBeVisible({ timeout: 25_000 })
  await page.keyboard.press('Escape')
  await expect(paywall).toBeHidden()
  await expect(page.getByRole('img', { name: 'After' })).toBeVisible()
})
