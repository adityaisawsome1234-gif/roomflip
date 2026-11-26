'use server'

import { redirect } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/config/site'
import { consumePostLoginPath } from './post-login'
import { trackSignupIfNew } from './signup-event'

/** Token types an emailed sign-in link may carry. */
const EMAIL_LINK_TYPES: readonly EmailOtpType[] = ['email', 'magiclink', 'signup']

/**
 * Exchange the one-time token from an emailed sign-in link for a session.
 * Submitted by the form on /auth/confirm (a POST, so link scanners that only
 * issue GET requests cannot use up the token).
 */
export async function confirmEmailLink(formData: FormData): Promise<never> {
  const tokenHash = formData.get('token_hash')
  const type = formData.get('type')

  if (
    typeof tokenHash !== 'string' ||
    tokenHash.length === 0 ||
    tokenHash.length > 256 ||
    typeof type !== 'string' ||
    !EMAIL_LINK_TYPES.includes(type as EmailOtpType)
  ) {
    redirect(`${ROUTES.login}?error=link_invalid`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  })
  if (error) {
    redirect(`${ROUTES.login}?error=link_expired`)
  }
  trackSignupIfNew(data.user, 'email')

  redirect(await consumePostLoginPath())
}

/** Sign the current user out on this device and return to the login page. */
export async function signOut(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  redirect(ROUTES.login)
}
