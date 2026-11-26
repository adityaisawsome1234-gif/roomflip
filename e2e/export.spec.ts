import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

test.skip(
  !!process.env.E2E_PROD && !(process.env.OPENAI_API_KEY && process.env.FAL_KEY),
  'Production builds need OPENAI_API_KEY and FAL_KEY for the render pipeline',
)
test.skip(({ browserName }) => browserName !== 'chromium')

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS package with a path export
const ffmpeg = require('ffmpeg-static') as string

/** What ffmpeg says about a video file: codecs, size, duration. */
function probe(data: Buffer) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'probe-')), 'v.mp4')
  writeFileSync(file, data)
  let out = ''
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: 'pipe' })
  } catch (error) {
    out = String((error as { stderr?: Buffer }).stderr ?? '')
  }
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(out)
  return {
    video: /Video: h264/.test(out),
    audio: /Audio: aac/.test(out),
    size: /, (\d{3,4})x(\d{3,4})[ ,]/.exec(out)?.slice(1, 3).map(Number),
    seconds: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : 0,
  }
}

async function finishedRender(page: Page, api: APIRequestContext): Promise<string> {
  const photo = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#a3aeb8' },
  })
    .jpeg()
    .toBuffer()
  const { room } = await (
    await api.post('/api/rooms', {
      multipart: {
        photo: { name: 'r.jpg', mimeType: 'image/jpeg', buffer: photo },
        roomType: 'Living room',
      },
    })
  ).json()
  const { renderId } = await (
    await api.post('/api/renders', {
      data: { tier: 'preview', roomId: room.id, choice: { mode: 'style', preset: 'japandi' } },
    })
  ).json()
  await expect
    .poll(async () => (await (await api.get(`/api/renders/${renderId}`)).json()).render.status, {
      timeout: 20_000,
    })
    .toBe('succeeded')
  return renderId
}

test('a free reel is a 720x1280 H.264 video of about 8 seconds, made once and reused', async ({
  page,
}) => {
  await signInAs(page, uniqueEmail('reel'))
  const renderId = await finishedRender(page, page.request)

  const first = await page.request.post(`/api/renders/${renderId}/export`, {
    data: { kind: 'reel' },
  })
  expect(first.status()).toBe(200)
  const { export: reel } = await first.json()
  expect(reel).toMatchObject({
    kind: 'reel',
    width: 720,
    height: 1280,
    watermarked: true,
    mimeType: 'video/mp4',
  })
  expect(reel.filename).toBe('roomflip-japandi-reel.mp4')

  const video = await page.request.get(reel.url)
  expect(video.status()).toBe(200)
  const info = probe(await video.body())
  expect(info).toMatchObject({ video: true, audio: true, size: [720, 1280] })
  expect(info.seconds).toBeGreaterThanOrEqual(6)
  expect(info.seconds).toBeLessThanOrEqual(10)

  const download = await page.request.get(reel.downloadUrl)
  expect(download.headers()['content-disposition']).toContain('roomflip-japandi-reel.mp4')

  // The second request reuses the stored file.
  const again = await (
    await page.request.post(`/api/renders/${renderId}/export`, { data: { kind: 'reel' } })
  ).json()
  const { data: rows } = await adminClient()
    .from('exports')
    .select('kind, variant')
    .eq('render_id', renderId)
  expect(rows).toEqual([{ kind: 'reel', variant: 'free' }])
  expect(again.export.filename).toBe(reel.filename)
})

test('the square image is a watermarked 1024px JPEG for free users', async ({ page }) => {
  await signInAs(page, uniqueEmail('square'))
  const renderId = await finishedRender(page, page.request)
  const { export: square } = await (
    await page.request.post(`/api/renders/${renderId}/export`, { data: { kind: 'square' } })
  ).json()
  const meta = await sharp(await (await page.request.get(square.url)).body()).metadata()
  expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1024, 1024])
  expect(square.watermarked).toBe(true)
})

test('a paid user gets a clean 1080x1920 reel', async ({ page }) => {
  const email = uniqueEmail('paidreel')
  await signInAs(page, email)
  const renderId = await finishedRender(page, page.request)
  const { data: profile } = await adminClient()
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
  await adminClient().rpc('grant_credits', {
    p_user_id: profile!.id,
    p_amount: 20,
    p_kind: 'pack_purchase',
    p_bucket: 'pack',
    p_idempotency_key: `test:${randomUUID()}`,
  })
  const { export: reel } = await (
    await page.request.post(`/api/renders/${renderId}/export`, { data: { kind: 'reel' } })
  ).json()
  expect(reel).toMatchObject({ width: 1080, height: 1920, watermarked: false })
  expect(probe(await (await page.request.get(reel.url)).body()).size).toEqual([1080, 1920])
})

test('exports need a finished render of your own', async ({ page, browser }) => {
  await signInAs(page, uniqueEmail('exportowner'))
  const renderId = await finishedRender(page, page.request)
  expect(
    (
      await page.request.post(`/api/renders/${renderId}/export`, { data: { kind: 'gif' } })
    ).status(),
  ).toBe(400)

  const other = await browser.newContext()
  const intruder = await other.newPage()
  await signInAs(intruder, uniqueEmail('exportintruder'))
  expect(
    (
      await intruder.request.post(`/api/renders/${renderId}/export`, { data: { kind: 'reel' } })
    ).status(),
  ).toBe(404)
  await other.close()
})

test('from the result screen: make the reel, watch it, download it', async ({ page }) => {
  await signInAs(page, uniqueEmail('reelui'))
  const renderId = await finishedRender(page, page.request)
  await page.goto(`/app/render/${renderId}`)
  await page.getByRole('button', { name: 'Video reel' }).click()
  const video = page.getByLabel('Your before-and-after video')
  await expect(video).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'download',
    'roomflip-japandi-reel.mp4',
  )
  await expect(page.getByText('Free exports carry a small RoomFlip mark.')).toBeVisible()
})
