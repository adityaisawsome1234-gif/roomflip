'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { trackSignupIfNew } from '@/lib/auth/signup-event'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { consumePostLoginPath, rememberPostLoginPath } from '@/lib/auth/post-login'
import { safeNextPath } from '@/lib/auth/redirects'
import { ROUTES } from '@/lib/config/site'
import { publicEnv } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import {
  codeSchema,
  emailSchema,
  sendFailureMessage,
  SIGN_IN_MESSAGES,
  verifyFailureMessage,
  type RequestSignInState,
  type VerifyCodeState,
} from './sign-in'

/** What was typed, cut to a sane length, for echoing back into the field. */
function echo(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.slice(0, 320) : ''
}

/**
 * Email a sign-in link and a 6-digit code. First-time and returning people
 * take the same path and get the same answer, so the response never reveals
 * whether an account exists.
 */
export async function requestSignIn(
  _previous: RequestSignInState,
  formData: FormData,
): Promise<RequestSignInState> {
  const typed = formData.get('email')
  const parsed = emailSchema.safeParse(typed)
  if (!parsed.success) {
    return { status: 'error', message: SIGN_IN_MESSAGES.invalidEmail, email: echo(typed) }
  }
  const email = parsed.data

  // Stop email bombing: a few sign-in emails per address and per network.
  const limit = await checkRateLimit('signInEmail', { ip: clientIp(await headers()), email })
  if (!limit.allowed) {
    return { status: 'error', message: SIGN_IN_MESSAGES.rateLimited, email: echo(typed) }
  }

  // The emailed link carries only a one-time token, so remember where to go
  // afterwards. Unsafe values are dropped by rememberPostLoginPath.
  await rememberPostLoginPath(formData.get('next'))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${publicEnv.siteUrl}${ROUTES.authConfirm}`,
    },
  })
  if (error) {
    // Log the cause for us; show the person a plain message, never Supabase's text.
    console.error('[login] could not send sign-in email:', error.code ?? error.status ?? 'unknown')
    return { status: 'error', message: sendFailureMessage(error), email: echo(typed) }
  }

  return { status: 'sent', email }
}

/**
 * Exchange the 6-digit code from the sign-in email for a session, then go to
 * where the person was heading. Returns only on failure.
 */
export async function verifySignInCode(
  _previous: VerifyCodeState,
  formData: FormData,
): Promise<VerifyCodeState> {
  const email = emailSchema.safeParse(formData.get('email'))
  const code = codeSchema.safeParse(formData.get('code'))
  if (!email.success || !code.success) {
    return { status: 'error', message: SIGN_IN_MESSAGES.codeFailed }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: code.data,
    type: 'email',
  })
  if (error) {
    return { status: 'error', message: verifyFailureMessage(error) }
  }
  trackSignupIfNew(data.user, 'email')

  // Clear the destination remembered for the emailed link so it cannot linger
  // and steer a later sign-in. Both values are same-site paths by construction.
  const remembered = await consumePostLoginPath()
  redirect(safeNextPath(formData.get('next'), remembered))
}
