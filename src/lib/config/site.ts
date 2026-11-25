/**
 * Brand and site constants. "RoomFlip" is a placeholder name: change it here.
 * The one place this file can't reach is the sign-in email template
 * (supabase/templates/sign_in.html), which has the name written out.
 */
export const SITE = {
  name: 'RoomFlip',
  tagline: 'Restyle any room from one photo',
  description:
    'Snap a photo of your room and see it restyled in seconds. Same walls, same windows, new look.',
  /** Shown on the reel end card and on watermarks. */
  madeWith: 'Made with RoomFlip',
  themeColor: { light: '#faf8f5', dark: '#121110' },
} as const

/** Route paths used in redirects and navigation, kept in one place. */
export const ROUTES = {
  home: '/',
  login: '/login',
  app: '/app',
  rooms: '/app/rooms',
  account: '/app/account',
  offline: '/offline',
  authCallback: '/auth/callback',
  authConfirm: '/auth/confirm',
} as const

/** Path prefixes that require a signed-in user. */
export const PROTECTED_PREFIXES = ['/app', '/admin', '/dev'] as const
