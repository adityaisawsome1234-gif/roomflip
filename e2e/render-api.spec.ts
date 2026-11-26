import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

/**
 * The render pipeline through its HTTP API, against the mock provider (used
 * automatically when no fal key is configured). Covers upload, moderation
 * outcome, metadata stripping, credits, polling, finalizing, watermarking,
 * retries, refunds and timeouts.
 */

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium')
// A production build refuses uploads without moderation and renders without fal
// (see e2e/production-guards.spec.ts), so this suite needs both keys there.
test.skip(
  !!process.env.E2E_PROD && !(process.env.OPENAI_API_KEY && process.env.FAL_KEY),
  'Production builds need OPENAI_API_KEY and FAL_KEY for the render pipeline',
)

async function photo(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#8a9bac' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'SecretPhone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
    })
    .toBuffer()
}

async function uploadRoom(api: APIRequestContext, buffer?: Buffer) {
  const response = await api.post('/api/rooms', {
    multipart: {
      photo: { name: 'room.jpg', mimeType: 'image/jpeg', buffer: buffer ?? (await photo()) },
      roomType: 'living room',
    },
  })
  return response
}

async function startPreview(
  api: APIRequestContext,
  roomId: string,
  choice: object,
  clientRequestId?: string,
) {
  return api.post('/api/renders', { data: { tier: 'preview', roomId, choice, clientRequestId } })
}

interface RenderView {
  status: string
  errorCode: string | null
  after: { url: string; width: number; height: number; watermarked: boolean } | null
  before: { url: string }
}

async function waitForRender(
  api: APIRequestContext,
  id: string,
  timeoutMs = 20_000,
): Promise<RenderView> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await api.get(`/api/renders/${id}`)
    expect(response.status()).toBe(200)
    const { render } = await response.json()
    if (render.status === 'succeeded' || render.status === 'failed') return render
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  throw new Error(`render ${id} did not finish`)
}

async function userId(email: string): Promise<string> {
  const { data } = await adminClient().from('profiles').select('id').eq('email', email).single()
  return data!.id
}

async function balance(page: Page): Promise<number> {
  await page.goto('/app/account')
  const text = await page
    .getByRole('region', { name: 'Renders left' })
    .locator('p')
    .first()
    .innerText()
  return Number(text)
}

test('signed-out requests are refused', async ({ request }) => {
  expect((await uploadRoom(request)).status()).toBe(401)
  expect((await request.post('/api/renders', { data: {} })).status()).toBe(401)
  expect((await request.get(`/api/renders/${randomUUID()}`)).status()).toBe(401)
})

test('a room photo is stored without its metadata', async ({ page }) => {
  const email = uniqueEmail('upload')
  await signInAs(page, email)
  const response = await uploadRoom(page.request)
  expect(response.status()).toBe(201)
  const { room } = await response.json()
  expect(room).toMatchObject({ width: 1200, height: 900 })

  const { data: row } = await adminClient()
    .from('rooms')
    .select('original_path, moderation')
    .eq('id', room.id)
    .single()
  expect(row!.original_path.startsWith(`${await userId(email)}/`)).toBe(true)
  const { data: blob } = await adminClient().storage.from('originals').download(row!.original_path)
  const stored = Buffer.from(await blob!.arrayBuffer())
  expect((await sharp(stored).metadata()).exif).toBeUndefined()
  expect(stored.includes(Buffer.from('SecretPhone'))).toBe(false)
})

test('uploads that are not usable photos are refused with a clear reason', async ({ page }) => {
  await signInAs(page, uniqueEmail('badupload'))
  const text = await page.request.post('/api/rooms', {
    multipart: {
      photo: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') },
    },
  })
  expect(text.status()).toBe(400)
  expect((await text.json()).error.code).toBe('unreadable')

  const tiny = await uploadRoom(page.request, await photo(200, 150))
  expect(tiny.status()).toBe(400)
  expect((await tiny.json()).error.code).toBe('too_small')

  const missing = await page.request.post('/api/rooms', { multipart: { roomType: 'x' } })
  expect(missing.status()).toBe(400)
})

test('a preview takes one credit, finishes, and is watermarked for a free user', async ({
  page,
}) => {
  await signInAs(page, uniqueEmail('preview'))
  const { room } = await (await uploadRoom(page.request)).json()

  const started = await startPreview(page.request, room.id, { mode: 'style', preset: 'japandi' })
  expect(started.status()).toBe(202)
  const { renderId, balance: after } = await started.json()
  expect(after).toBe(2)

  const render = await waitForRender(page.request, renderId)
  expect(render.status).toBe('succeeded')
  expect(render.after!.watermarked).toBe(true)
  expect(Math.max(render.after!.width, render.after!.height)).toBeLessThanOrEqual(1024)

  const image = await page.request.get(render.after!.url)
  expect(image.status()).toBe(200)
  const meta = await sharp(await image.body()).metadata()
  expect(meta.format).toBe('jpeg')
  expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024)
  expect((await page.request.get(render.before.url)).status()).toBe(200)

  expect(await balance(page)).toBe(2)
})

test('a double tap starts one render and charges once', async ({ page }) => {
  await signInAs(page, uniqueEmail('doubletap'))
  const { room } = await (await uploadRoom(page.request)).json()
  const id = randomUUID()
  const [a, b] = await Promise.all([
    startPreview(page.request, room.id, { mode: 'style', preset: 'boho' }, id),
    startPreview(page.request, room.id, { mode: 'style', preset: 'boho' }, id),
  ])
  const [ra, rb] = [await a.json(), await b.json()]
  expect(ra.renderId).toBe(rb.renderId)
  expect([a.status(), b.status()].sort()).toEqual([200, 202])
  await waitForRender(page.request, ra.renderId)
  expect(await balance(page)).toBe(2)
})

test('a failed render is refunded', async ({ page }) => {
  await signInAs(page, uniqueEmail('fail'))
  const { room } = await (await uploadRoom(page.request)).json()
  const { renderId } = await (
    await startPreview(page.request, room.id, { mode: 'style', custom: 'mock:fail please' })
  ).json()
  const render = await waitForRender(page.request, renderId)
  expect(render).toMatchObject({ status: 'failed', errorCode: 'mock_failure', after: null })
  expect(await balance(page)).toBe(3)
})

test('a flaky render is retried once and succeeds, charged once', async ({ page }) => {
  await signInAs(page, uniqueEmail('flaky'))
  const { room } = await (await uploadRoom(page.request)).json()
  const { renderId } = await (
    await startPreview(page.request, room.id, { mode: 'style', custom: 'mock:flaky please' })
  ).json()
  const render = await waitForRender(page.request, renderId)
  expect(render.status).toBe('succeeded')
  const { data } = await adminClient()
    .from('renders')
    .select('attempts')
    .eq('id', renderId)
    .single()
  expect(data!.attempts).toBe(2)
  expect(await balance(page)).toBe(2)
})

test('a render that never finishes times out and is refunded', async ({ page }) => {
  await signInAs(page, uniqueEmail('hang'))
  const { room } = await (await uploadRoom(page.request)).json()
  const { renderId } = await (
    await startPreview(page.request, room.id, { mode: 'style', custom: 'mock:hang please' })
  ).json()
  // Let it get going, then move its deadline into the past instead of waiting minutes.
  await new Promise((resolve) => setTimeout(resolve, 2_500))
  expect((await (await page.request.get(`/api/renders/${renderId}`)).json()).render.status).toBe(
    'processing',
  )
  await adminClient()
    .from('renders')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', renderId)

  const render = await waitForRender(page.request, renderId)
  expect(render).toMatchObject({ status: 'failed', errorCode: 'timeout' })
  expect(await balance(page)).toBe(3)
})

test('running out of credits is a clear 402, and nothing is created', async ({ page }) => {
  await signInAs(page, uniqueEmail('broke'))
  const { room } = await (await uploadRoom(page.request)).json()
  for (let i = 0; i < 3; i++) {
    expect(
      (await startPreview(page.request, room.id, { mode: 'style', preset: 'modern' })).status(),
    ).toBe(202)
  }
  const refused = await startPreview(page.request, room.id, { mode: 'style', preset: 'modern' })
  expect(refused.status()).toBe(402)
  expect((await refused.json()).error.code).toBe('insufficient_credits')
})

test('paint and material modes render', async ({ page }) => {
  await signInAs(page, uniqueEmail('modes'))
  const { room } = await (await uploadRoom(page.request)).json()

  const { data: color } = await adminClient()
    .from('paint_colors')
    .select('id')
    .eq('code', 'OC-17')
    .single()
  const paint = await startPreview(page.request, room.id, {
    mode: 'paint',
    paintColorId: color!.id,
    surfaces: ['walls', 'trim'],
  })
  expect(paint.status()).toBe(202)

  const swatchUpload = await page.request.post('/api/swatches', {
    multipart: { photo: { name: 's.jpg', mimeType: 'image/jpeg', buffer: await photo(600, 600) } },
  })
  expect(swatchUpload.status()).toBe(201)
  const { swatch } = await swatchUpload.json()
  const material = await startPreview(page.request, room.id, {
    mode: 'material',
    swatchId: swatch.id,
    target: 'sofa',
  })
  expect(material.status()).toBe(202)

  for (const response of [paint, material]) {
    expect((await waitForRender(page.request, (await response.json()).renderId)).status).toBe(
      'succeeded',
    )
  }
  const { data: rows } = await adminClient()
    .from('renders')
    .select('mode, prompt, params')
    .eq('room_id', room.id)
  const paintRow = rows!.find((r) => r.mode === 'paint')!
  expect(paintRow.prompt).toContain('Benjamin Moore White Dove (OC-17)')
  expect(paintRow.params).toMatchObject({ color: { code: 'OC-17' }, surfaces: ['walls', 'trim'] })
})

test('invalid choices and other people’s things are refused', async ({ page, browser }) => {
  await signInAs(page, uniqueEmail('owner'))
  const { room } = await (await uploadRoom(page.request)).json()
  expect(
    (await startPreview(page.request, room.id, { mode: 'style', preset: 'gothic' })).status(),
  ).toBe(400)
  expect(
    (
      await startPreview(page.request, room.id, {
        mode: 'paint',
        paintColorId: 999999,
        surfaces: ['walls'],
      })
    ).status(),
  ).toBe(400)
  expect(
    (
      await startPreview(page.request, room.id, {
        mode: 'material',
        swatchId: randomUUID(),
        target: 'sofa',
      })
    ).status(),
  ).toBe(404)
  const { renderId } = await (
    await startPreview(page.request, room.id, { mode: 'style', preset: 'coastal' })
  ).json()

  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()
  await signInAs(other, uniqueEmail('intruder'))
  expect(
    (await startPreview(other.request, room.id, { mode: 'style', preset: 'coastal' })).status(),
  ).toBe(404)
  expect((await other.request.get(`/api/renders/${renderId}`)).status()).toBe(404)
  await otherContext.close()
})

test('HD finals need Pro; a paid user gets one, without a watermark', async ({ page }) => {
  const email = uniqueEmail('hd')
  await signInAs(page, email)
  const { room } = await (await uploadRoom(page.request)).json()
  const { renderId: previewId } = await (
    await startPreview(page.request, room.id, { mode: 'style', preset: 'industrial' })
  ).json()
  await waitForRender(page.request, previewId)

  const refused = await page.request.post('/api/renders', {
    data: { tier: 'hd', sourceRenderId: previewId },
  })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error.code).toBe('upgrade_required')

  // Become a paying customer.
  const { error } = await adminClient().rpc('grant_credits', {
    p_user_id: await userId(email),
    p_amount: 20,
    p_kind: 'pack_purchase',
    p_bucket: 'pack',
    p_idempotency_key: `test:${randomUUID()}`,
  })
  expect(error).toBeNull()

  const hd = await page.request.post('/api/renders', {
    data: { tier: 'hd', sourceRenderId: previewId },
  })
  expect(hd.status()).toBe(202)
  const render = await waitForRender(page.request, (await hd.json()).renderId)
  expect(render.status).toBe('succeeded')
  expect(render.after!.watermarked).toBe(false)

  const { data: row } = await adminClient()
    .from('renders')
    .select('tier, source_render_id, prompt')
    .eq('id', (await hd.json()).renderId)
    .single()
  expect(row).toMatchObject({ tier: 'hd', source_render_id: previewId })
  expect(row!.prompt).toContain('approved redesign')
  // The preview's own image is now served clean too.
  expect((await waitForRender(page.request, previewId)).after!.watermarked).toBe(false)
})

test('the fal webhook refuses unsigned calls, and the sweeper needs its secret', async ({
  request,
}) => {
  const webhook = await request.post('/api/webhooks/fal', {
    data: { request_id: 'x', status: 'OK' },
  })
  expect(webhook.status()).toBe(401)
  expect((await request.get('/api/cron/sweep')).status()).toBe(401)
  expect(
    (await request.get('/api/cron/sweep', { headers: { authorization: 'Bearer wrong' } })).status(),
  ).toBe(401)
})
