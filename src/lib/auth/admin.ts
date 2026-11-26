import 'server-only'

import { optionalServerEnv } from '@/lib/env.server'
import type { SessionUser } from './session'

/** Emails listed in ADMIN_EMAILS (comma-separated, case-insensitive). */
export function isAdmin(user: SessionUser | null): boolean {
  if (!user?.email) return false
  const admins = (optionalServerEnv('ADMIN_EMAILS') ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(user.email.toLowerCase())
}

/**
 * The developer tools (/dev/*) spend real money on model calls. Anyone signed
 * in may use them in local development; in production only admins may.
 */
export function canUseDevTools(user: SessionUser | null): boolean {
  if (!user) return false
  return process.env.NODE_ENV !== 'production' || isAdmin(user)
}
