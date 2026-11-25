import { PROTECTED_PREFIXES, ROUTES } from '@/lib/config/site'

const MAX_NEXT_LENGTH = 512

/**
 * Turn an untrusted "where to go after sign-in" value into a safe same-site
 * path. Anything that could leave the site (absolute URLs, `//host`,
 * backslash tricks, control characters) falls back to the app home.
 */
export function safeNextPath(input: unknown, fallback: string = ROUTES.app): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_NEXT_LENGTH) {
    return fallback
  }
  // Must be an absolute path on this site: one leading slash, not two.
  if (!input.startsWith('/') || input.startsWith('//')) return fallback
  // Browsers treat backslashes like slashes; control characters get stripped.
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return fallback

  let url: URL
  try {
    url = new URL(input, 'http://roomflip.invalid')
  } catch {
    return fallback
  }
  if (url.origin !== 'http://roomflip.invalid') return fallback

  const path = `${url.pathname}${url.search}${url.hash}`
  if (!path.startsWith('/') || path.startsWith('//')) return fallback
  // Never bounce back into the auth pages themselves.
  if (url.pathname === ROUTES.login || url.pathname.startsWith('/auth/')) return fallback
  return path
}

/** Whether a pathname is behind sign-in. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/** The login URL that returns the user to `next` afterwards. */
export function loginPath(next?: string): string {
  const safe = next ? safeNextPath(next, '') : ''
  return safe ? `${ROUTES.login}?next=${encodeURIComponent(safe)}` : ROUTES.login
}
