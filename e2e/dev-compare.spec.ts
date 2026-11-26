import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { signInAs } from './helpers/session'
import { uniqueEmail } from './helpers/supabase'

async function roomPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7d8e9f' } })
    .jpeg()
    .toBuffer()
}

test('the compare page runs a photo through the chosen models and shows each cost', async ({
  page,
}) => {
  test.skip(!!process.env.E2E_PROD, 'Developer tools are admin-only in production')
  await signInAs(page, uniqueEmail('compare'))
  await page.goto('/dev/compare')
  await expect(page.getByRole('heading', { name: 'Compare models' })).toBeVisible()

  // Only the free mock model, so the test never spends money.
  await page.waitForLoadState('networkidle')
  const models = page.getByRole('group', { name: '3. Models' })
  // Retried: a click that lands before React hydrates the form is undone by hydration.
  await expect(async () => {
    for (const box of await models.getByRole('checkbox').all()) await box.uncheck()
    await models.getByRole('checkbox', { name: /Mock/ }).check()
    await expect(page.getByRole('button', { name: 'Run 1 model' })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.getByText('This run costs about $0.')).toBeVisible()

  await page
    .getByLabel('Room photo')
    .setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: await roomPhoto() })
  await page.getByRole('button', { name: 'Run 1 model' }).click()

  const results = page.getByRole('region', { name: 'Results' })
  await expect(results.getByRole('img', { name: 'Original room' })).toBeVisible()
  await expect(results.getByRole('img', { name: /Mock .* result/ })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText('Prompt sent to every model')).toBeVisible()
})

test('the compare page is hidden from signed-in non-admins in production', async ({ page }) => {
  test.skip(!process.env.E2E_PROD, 'Only meaningful against a production build')
  await signInAs(page, uniqueEmail('notadmin'))
  // The page shell is streamed before the access check runs, so the status is
  // 200; what matters is that the tool never renders and the API refuses.
  await page.goto('/dev/compare')
  await expect(page.getByText('This page could not be found.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Run / })).toHaveCount(0)
  const api = await page.request.get(
    '/api/dev/compare/status?provider=mock&endpoint=mock&requestId=x',
  )
  expect(api.status()).toBe(403)
})
