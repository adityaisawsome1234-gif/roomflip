import 'server-only'

import { createHash } from 'node:crypto'
import { RATE_LIMITS, type Limit, type RateLimitedAction } from '@/lib/config/limits'
import { createAdminClient } from '@/lib/supabase/admin'
import { jsonError } from '@/lib/api'
import { optionalServerEnv } from '@/lib/env.server'

/** The client's IP, from the proxy headers Vercel sets. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip') || null
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/** IPs never limited per IP (RATE_LIMIT_EXEMPT_IPS), e.g. for testing a production build locally. */
function isExemptIp(ip: string): boolean {
  if (process.env.NODE_ENV !== 'production' && isLoopback(ip)) return true
  const list = optionalServerEnv('RATE_LIMIT_EXEMPT_IPS') ?? ''
  return list
    .split(',')
    .map((entry) => entry.trim())
    .includes(ip)
}

/** Emails and IPs are hashed before use as keys: the table never holds them in plain text. */
function digest(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 32)
}

export interface RateLimitOutcome {
  allowed: boolean
  retryAfter: number
}

/**
 * Count one request against every applicable limit for an action. Allowed only
 * if all of them allow it. Local development does not limit loopback IPs (the
 * test suite runs from one), but per-user limits always apply.
 */
export async function checkRateLimit(
  action: RateLimitedAction,
  subjects: { userId?: string | null; ip?: string | null; email?: string | null },
): Promise<RateLimitOutcome> {
  const rules = RATE_LIMITS[action] as Partial<Record<'user' | 'ip' | 'email', Limit>>
  const checks: { key: string; limit: Limit }[] = []
  if (rules.user && subjects.userId)
    checks.push({ key: `${action}:user:${subjects.userId}`, limit: rules.user })
  if (rules.ip && subjects.ip && !isExemptIp(subjects.ip)) {
    checks.push({ key: `${action}:ip:${digest(subjects.ip)}`, limit: rules.ip })
  }
  if (rules.email && subjects.email)
    checks.push({ key: `${action}:email:${digest(subjects.email)}`, limit: rules.email })

  const db = createAdminClient()
  let outcome: RateLimitOutcome = { allowed: true, retryAfter: 0 }
  for (const check of checks) {
    const { data, error } = await db.rpc('rate_limit_hit', {
      p_key: check.key,
      p_limit: check.limit[0],
      p_window_seconds: check.limit[1],
    })
    // If the limiter itself fails, let the request through rather than take the app down.
    if (error || !data?.[0]) continue
    if (!data[0].allowed) {
      outcome = { allowed: false, retryAfter: Math.max(outcome.retryAfter, data[0].retry_after) }
    }
  }
  return outcome
}

/** A 429 response with Retry-After. */
export function tooManyRequests(retryAfter: number): Response {
  const response = jsonError(429, 'rate_limited', 'Too many requests. Wait a little and try again.')
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

/** Check a limit for a route handler; returns a 429 response to send, or null to carry on. */
export async function limitRequest(
  action: RateLimitedAction,
  request: Request,
  userId: string,
): Promise<Response | null> {
  const outcome = await checkRateLimit(action, { userId, ip: clientIp(request.headers) })
  return outcome.allowed ? null : tooManyRequests(outcome.retryAfter)
}
