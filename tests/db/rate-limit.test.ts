import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkRateLimit } from '@/lib/rate-limit'
import { serviceClient, sql } from '../helpers/db'

describe('rate limiting', () => {
  it('allows exactly the limit under concurrent requests', async () => {
    const key = `test:${randomUUID()}`
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        serviceClient().rpc('rate_limit_hit', { p_key: key, p_limit: 5, p_window_seconds: 60 }),
      ),
    )
    const allowed = results.filter((r) => r.data?.[0]?.allowed)
    expect(allowed).toHaveLength(5)
    const refused = results.find((r) => r.data?.[0]?.allowed === false)!
    expect(refused.data![0].retry_after).toBeGreaterThan(0)
    expect(refused.data![0].retry_after).toBeLessThanOrEqual(60)
  })

  it('limits per user across actions independently, and stores no email or IP in clear', async () => {
    const userId = randomUUID()
    for (let i = 0; i < 20; i++)
      expect((await checkRateLimit('render', { userId })).allowed).toBe(true)
    expect((await checkRateLimit('render', { userId })).allowed).toBe(false)
    expect((await checkRateLimit('upload', { userId })).allowed).toBe(true)

    await checkRateLimit('signInEmail', { email: 'Someone@Example.test', ip: '203.0.113.9' })
    const rows = await sql<{ key: string }>(
      `select key from public.rate_limits where key like 'signInEmail:%'`,
    )
    for (const { key } of rows) {
      expect(key).not.toContain('someone')
      expect(key).not.toContain('203.0.113.9')
    }
  })

  it('applies per-IP limits to real addresses', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`
    let last = { allowed: true, retryAfter: 0 }
    for (let i = 0; i < 61; i++) last = await checkRateLimit('render', { userId: randomUUID(), ip })
    expect(last.allowed).toBe(false)
  })
})
