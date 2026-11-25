import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

export interface SessionUpdate {
  /** Pass-through response carrying any refreshed session cookies. */
  response: NextResponse
  /** Verified user id, or null when there is no valid session. */
  userId: string | null
}

/**
 * Refresh the Supabase session for this request.
 *
 * Server Components cannot write cookies, so the proxy is where an expired
 * access token gets refreshed. The refreshed cookies are written to the request
 * (so Server Components rendering this request see them) and to the response
 * (so the browser stores them).
 */
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
          // Cache-Control headers that stop a CDN from caching a response that sets a session.
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value))
        },
      },
    },
  )

  // Do not add code between createServerClient and getClaims: getClaims is what
  // refreshes the token, and skipping it logs users out at random.
  const { data, error } = await supabase.auth.getClaims()
  const userId = !error && data?.claims?.sub ? data.claims.sub : null

  return { response, userId }
}

/**
 * Build a redirect that keeps whatever session cookies and cache headers
 * `updateSession` put on the pass-through response.
 */
export function redirectKeepingSession(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  for (const name of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(name)
    if (value) redirect.headers.set(name, value)
  }
  return redirect
}
