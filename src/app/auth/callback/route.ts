import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath } from '@/lib/auth/redirects'
import { ROUTES } from '@/lib/config/site'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth (Google) return URL. Supabase redirects here with a one-time `code`,
 * which is exchanged for a session using the PKCE verifier stored in this
 * browser's cookies when sign-in started.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  const failure = new URL(ROUTES.login, origin)
  failure.searchParams.set('error', 'oauth_failed')
  return NextResponse.redirect(failure)
}
