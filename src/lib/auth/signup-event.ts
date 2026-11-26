import 'server-only'

import type { User } from '@supabase/supabase-js'
import { trackLater } from '@/lib/analytics'

/**
 * Report a signup the first time a new account signs in. An account counts as
 * new when it was created in the last two minutes and its email was confirmed
 * by this very sign-in. The event carries a stable id, so if both conditions
 * ever match twice PostHog still keeps one signup per user.
 */
export function trackSignupIfNew(user: User | null | undefined, method: 'email' | 'google'): void {
  if (!user) return
  const now = Date.now()
  const created = new Date(user.created_at).getTime()
  const confirmed = user.email_confirmed_at ? new Date(user.email_confirmed_at).getTime() : created
  if (now - created > 120_000 || now - confirmed > 30_000) return
  trackLater('signup', user.id, { method }, `signup:${user.id}`)
}
