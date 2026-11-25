import { type NextRequest } from 'next/server'
import { isProtectedPath, safeNextPath } from '@/lib/auth/redirects'
import { ROUTES } from '@/lib/config/site'
import { redirectKeepingSession, updateSession } from '@/lib/supabase/proxy'

/**
 * Runs before every matched request to:
 *   1. refresh the Supabase session cookies, and
 *   2. send signed-out visitors away from protected pages (and signed-in
 *      visitors away from the login page).
 *
 * The redirects here are a fast path for navigation. They are not the security
 * boundary: pages and actions call requireUser(), and the database enforces
 * row level security.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request)
  const { pathname, search } = request.nextUrl

  if (!userId && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = ROUTES.login
    url.search = ''
    url.searchParams.set('next', safeNextPath(`${pathname}${search}`))
    return redirectKeepingSession(url, response)
  }

  if (userId && pathname === ROUTES.login) {
    const next = safeNextPath(request.nextUrl.searchParams.get('next'))
    return redirectKeepingSession(new URL(next, request.url), response)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, PWA files and provider webhooks
     * (webhooks authenticate by signature, not by session).
     */
    '/((?!_next/static|_next/image|api/webhooks|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)',
  ],
}
