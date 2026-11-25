import { expect, type Page } from '@playwright/test'
import { adminClient } from './supabase'

/**
 * Sign a browser in as `email` without going through the mailbox: mint a
 * one-time token with the admin API, then use the app's own confirm page.
 * Creates the user if they do not exist yet.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.properties?.hashed_token) {
    throw new Error(`Could not mint a sign-in token for ${email}: ${error?.message ?? 'no token'}`)
  }
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`)
  await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 20_000 })
  await expect(page).toHaveURL(/\/app/)
}
