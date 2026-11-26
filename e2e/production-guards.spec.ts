import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { signInAs } from './helpers/session'
import { uniqueEmail } from './helpers/supabase'

/**
 * A production build must fail closed when a safety-critical service is not
 * configured: no unmoderated uploads, no silent fallback to the mock model.
 */
test.skip(!process.env.E2E_PROD, 'Only meaningful against a production build')

test('without moderation configured, uploads are refused rather than stored unchecked', async ({
  page,
}) => {
  test.skip(!!process.env.OPENAI_API_KEY, 'Moderation is configured')
  await signInAs(page, uniqueEmail('prodguard'))
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer()
  const response = await page.request.post('/api/rooms', {
    multipart: { photo: { name: 'room.jpg', mimeType: 'image/jpeg', buffer: photo } },
  })
  expect(response.status()).toBe(503)
  expect((await response.json()).error.code).toBe('unavailable')
})

test('without fal configured, renders are refused rather than faked', async ({ page }) => {
  test.skip(!!process.env.FAL_KEY, 'fal is configured')
  await signInAs(page, uniqueEmail('prodguard'))
  const response = await page.request.post('/api/renders', {
    data: { tier: 'preview', roomId: randomUUID(), choice: { mode: 'style', preset: 'modern' } },
  })
  expect(response.status()).toBe(503)
  expect((await response.json()).error.code).toBe('not_configured')
})
