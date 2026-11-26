import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { signInAs } from './helpers/session'
import { uniqueEmail } from './helpers/supabase'

/**
 * The restyle flow as a person uses it, against the mock model: photo,
 * choice, progress, before/after, save, regenerate, and the failure paths.
 */

test.skip(
  !!process.env.E2E_PROD && !(process.env.OPENAI_API_KEY && process.env.FAL_KEY),
  'Production builds need OPENAI_API_KEY and FAL_KEY for the render pipeline',
)

async function jpeg(width: number, height: number, background = '#9aa7b3'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer()
}

async function uploadRoom(page: Page) {
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Bedroom' }).click()
  await page
    .locator('input[type=file]:not([capture])')
    .setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: await jpeg(1200, 900) })
  await page.waitForURL(/\/app\/room\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Pick a new look' })).toBeVisible()
}

async function restyle(page: Page) {
  await page.getByRole('button', { name: 'Restyle my room' }).click()
  await page.waitForURL(/\/app\/render\/[0-9a-f-]{36}$/, { timeout: 20_000 })
}

async function expectResult(page: Page) {
  await expect(page.getByRole('img', { name: 'After' })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('img', { name: 'Before' })).toBeAttached()
}

const badge = (page: Page, n: number) =>
  page.getByRole('link', { name: `${n} ${n === 1 ? 'render' : 'renders'} left. View account.` })

test('style: photo to before/after, save, regenerate', async ({ page }) => {
  await signInAs(page, uniqueEmail('flow'))
  await uploadRoom(page)

  await page.getByRole('radio', { name: /Coastal/ }).click()
  await expect(page.getByRole('radio', { name: /Coastal/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Uses 1 of your 3 renders')).toBeVisible()
  await restyle(page)

  await expect(page.getByRole('heading', { name: 'Coastal' })).toBeVisible()
  await expectResult(page)
  await expect(page.getByText('Free renders carry a small watermark.')).toBeVisible()
  await expect(badge(page, 2)).toBeVisible()

  // The slider works from the keyboard.
  const slider = page.getByRole('slider', { name: 'Compare before and after' })
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuetext', '49% before')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
  const resultUrl = page.url()

  await page.getByRole('button', { name: /Regenerate/ }).click()
  await page.waitForURL((url) => url.href !== resultUrl && /\/app\/render\//.test(url.pathname))
  await expectResult(page)
  await expect(badge(page, 1)).toBeVisible()

  await page.getByRole('link', { name: 'Try another look' }).click()
  await expect(page.getByRole('heading', { name: "Looks you've tried" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Coastal' })).toHaveCount(2)

  await page.getByRole('link', { name: 'My rooms', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved looks' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Coastal' })).toHaveCount(1)
})

test('paint: search a colour, choose surfaces, render', async ({ page }) => {
  await signInAs(page, uniqueEmail('paint'))
  await uploadRoom(page)

  await page.getByRole('tab', { name: 'Paint' }).click()
  await page.getByRole('searchbox').fill('white dove')
  await page.getByRole('radio', { name: 'White Dove, OC-17' }).click()
  // Swatches keep their full height in the scrolling grid (they once collapsed to slivers).
  const tile = await page.getByRole('radio', { name: 'White Dove, OC-17' }).boundingBox()
  expect(tile!.height).toBeGreaterThan(70)
  await page.getByRole('button', { name: 'Trim' }).click()
  await expect(page.getByRole('button', { name: 'All walls' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await restyle(page)

  await expect(
    page.getByRole('heading', { name: 'White Dove on all walls and trim' }),
  ).toBeVisible()
  await expectResult(page)
})

test('material: upload a sample, place it, render', async ({ page }) => {
  await signInAs(page, uniqueEmail('material'))
  await uploadRoom(page)

  await page.getByRole('tab', { name: 'Material' }).click()
  // Nothing to restyle with yet: the button explains what is missing.
  await page.getByRole('button', { name: 'Restyle my room' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Add a photo of your sample.' }),
  ).toBeVisible()

  await page.getByLabel('Upload a sample photo').setInputFiles({
    name: 's.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpeg(600, 600, '#a0522d'),
  })
  await expect(page.getByRole('img', { name: 'Your sample' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('radio', { name: 'Sofa' }).click()
  await restyle(page)

  await expect(page.getByRole('heading', { name: 'New sofa' })).toBeVisible()
  await expectResult(page)
})

test('a failed render explains itself and gives the credit back', async ({ page }) => {
  await signInAs(page, uniqueEmail('failflow'))
  await uploadRoom(page)
  await page.getByLabel('Or describe your own').fill('mock:fail cosy cabin')
  await restyle(page)

  await expect(
    page.getByText("Your render was given back, so this one didn't cost anything."),
  ).toBeVisible({
    timeout: 20_000,
  })
  await expect(badge(page, 3)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('out of renders and HD for free users point to the plans', async ({ page }) => {
  await signInAs(page, uniqueEmail('limits'))
  await uploadRoom(page)
  const roomUrl = page.url()
  for (let i = 0; i < 3; i++) {
    await page.goto(roomUrl)
    await restyle(page)
  }
  await expectResult(page)

  // The third result was the last free one: the paywall opens over it. Close it to carry on.
  await page.getByRole('button', { name: 'Not now' }).click()

  await page.getByRole('button', { name: 'Save in HD' }).click()
  await expect(page.getByRole('dialog', { name: 'Save it in HD with Pro' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Opening the room with nothing left shows a calm prompt, not a pop-up.
  await page.goto(roomUrl)
  await expect(page.getByText("You've used all your renders")).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restyle my room' })).toHaveCount(0)
  await page.getByRole('button', { name: 'See plans' }).click()
  await expect(page.getByRole('dialog', { name: "You're out of renders" })).toBeVisible()
})

test('the flow fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await signInAs(page, uniqueEmail('layout'))
  await uploadRoom(page)

  const noSideScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  for (const tab of ['Style', 'Paint', 'Material']) {
    await page.getByRole('tab', { name: tab }).click()
    expect(await noSideScroll(), `${tab} tab scrolls sideways`).toBe(true)
  }

  // The call to action sits above the tab bar, not behind it.
  await page.getByRole('tab', { name: 'Style' }).click()
  const cta = await page.getByRole('button', { name: 'Restyle my room' }).boundingBox()
  const tabBar = await page.getByRole('navigation', { name: 'Main' }).boundingBox()
  expect(cta!.y + cta!.height).toBeLessThanOrEqual(tabBar!.y + 1)

  await restyle(page)
  await expectResult(page)
  expect(await noSideScroll()).toBe(true)
  await expect(page.getByRole('link', { name: 'Create' })).toHaveAttribute('aria-current', 'page')
})
