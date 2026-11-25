import 'server-only'

import { cookies } from 'next/headers'
import { safeNextPath } from './redirects'

/**
 * Where to send the user once an emailed sign-in link is confirmed.
 *
 * The link in the email carries only the one-time token, so the destination is
 * remembered in a short-lived cookie set when the email is requested. If the
 * link is opened in a different browser the cookie is absent and the user
 * lands on the app home, which is fine.
 */
const COOKIE = 'rf_next'
const MAX_AGE_SECONDS = 60 * 60

export async function rememberPostLoginPath(next: unknown): Promise<void> {
  const path = safeNextPath(next, '')
  const store = await cookies()
  if (!path) {
    store.delete(COOKIE)
    return
  }
  store.set(COOKIE, path, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

/** Read and clear the remembered destination. Always returns a safe same-site path. */
export async function consumePostLoginPath(): Promise<string> {
  const store = await cookies()
  const value = store.get(COOKIE)?.value
  if (value) store.delete(COOKIE)
  return safeNextPath(value)
}
