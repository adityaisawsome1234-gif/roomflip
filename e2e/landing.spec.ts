import { expect, test } from '@playwright/test'
import { CREDIT_PACKS, CREDITS, PLANS } from '../src/lib/config/pricing'

test('the landing page explains, shows, prices and answers', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /Restyle any room from one photo/,
  )
  await expect(page.getByText(`${CREDITS.signupGrant} free renders. No card needed.`)).toBeVisible()

  // The hero before/after plays on its own.
  const hero = page.getByRole('slider', { name: 'Compare before and after' }).first()
  const first = await hero.getAttribute('aria-valuetext')
  await expect.poll(() => hero.getAttribute('aria-valuetext'), { timeout: 5_000 }).not.toBe(first)

  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Three ways to restyle' })).toBeVisible()
  await expect(page.getByRole('figure').filter({ hasText: 'A real paint colour' })).toBeVisible()

  const pricing = page.getByRole('region', { name: 'Pricing' })
  await expect(pricing).toContainText(`$${PLANS.pro_annual.priceUsd}`)
  await expect(pricing).toContainText(`$${PLANS.pro_weekly.priceUsd}`)
  for (const pack of Object.values(CREDIT_PACKS)) {
    await expect(pricing).toContainText(`${pack.credits} for $${pack.priceUsd}`)
  }

  await page.getByText('Does it keep my actual room?').click()
  await expect(
    page.getByText('Your walls, windows, doors, layout and camera angle stay'),
  ).toBeVisible()

  await expect(
    page.getByText('Not affiliated with Benjamin Moore or Sherwin-Williams.'),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.getByRole('link', { name: 'Restyle my room free' }).first().click()
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/)
})

test('the hero holds still for people who prefer reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const hero = page.getByRole('slider', { name: 'Compare before and after' }).first()
  await page.waitForTimeout(1_500)
  await expect(hero).toHaveAttribute('aria-valuetext', '50% before')
})

test('the page has social sharing metadata', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /opengraph-image/,
  )
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /RoomFlip/)
})
