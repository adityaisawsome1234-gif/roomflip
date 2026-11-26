import { expect, test } from '@playwright/test'
import { CREDITS } from '../src/lib/config/pricing'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

test('a new account shows its free renders in the top bar and on the account tab', async ({
  page,
}) => {
  const email = uniqueEmail('credits')
  await signInAs(page, email)

  const badge = page.getByRole('link', {
    name: `${CREDITS.signupGrant} renders left. View account.`,
  })
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(String(CREDITS.signupGrant))

  await badge.click()
  await expect(page).toHaveURL(/\/app\/account$/)
  const card = page.getByRole('region', { name: 'Renders left' })
  await expect(card).toContainText(String(CREDITS.signupGrant))
  await expect(card).toContainText('Free')

  // The grant is written once, however many pages read the balance.
  await page.goto('/app/rooms')
  await expect(badge).toBeVisible()
  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('id').eq('email', email).single()
  const { data: rows } = await admin
    .from('credit_ledger')
    .select('amount, kind')
    .eq('user_id', profile!.id)
  expect(rows).toEqual([{ amount: CREDITS.signupGrant, kind: 'signup_grant' }])
})
