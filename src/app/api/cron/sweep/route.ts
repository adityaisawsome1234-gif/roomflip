import { timingSafeEqual } from 'node:crypto'
import { failStaleRenders } from '@/lib/credits/ledger'
import { optionalServerEnv } from '@/lib/env.server'
import { refreshNeglectedRenders } from '@/lib/render/jobs'

export const maxDuration = 60

function authorized(request: Request): boolean {
  const secret = optionalServerEnv('CRON_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Scheduled maintenance (Vercel Cron sends the CRON_SECRET bearer token):
 * refund renders past their deadline, and finish jobs whose webhook was lost
 * and that nobody is polling.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response('unauthorized', { status: 401 })
  const refreshed = await refreshNeglectedRenders(50)
  const failed = await failStaleRenders(500)
  return Response.json(
    { refreshed, timedOut: failed.length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
