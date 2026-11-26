import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/config/site'
import { loginPath } from './redirects'

/** The verified identity of the signed-in user. Safe to pass to Client Components. */
export interface SessionUser {
  id: string
  email: string | null
}

/**
 * The signed-in user, or null. The access token is verified (signature and
 * expiry) rather than trusted from the cookie. Deduplicated per request.
 *
 * Reads cookies: call it from a component inside <Suspense>, or from a Server
 * Action or Route Handler.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Verifying a session compares the token's expiry with the current time, so
  // it can only happen at request time, never in a prerender or prefetch.
  await connection()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null }
})

/**
 * The signed-in user, or a redirect to the login page. This is the real
 * authorization check for pages and actions; the proxy redirect is only a
 * fast path.
 */
export async function requireUser(returnTo: string = ROUTES.app): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(loginPath(returnTo))
  return user
}
