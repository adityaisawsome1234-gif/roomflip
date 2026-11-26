import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureRequest, stableEventId } from '@/lib/analytics'
import { RATE_LIMITS } from '@/lib/config/limits'

afterEach(() => vi.unstubAllEnvs())

describe('analytics', () => {
  it('is off without an API key', () => {
    vi.stubEnv('POSTHOG_API_KEY', '')
    expect(captureRequest('signup', 'u1')).toBeNull()
  })

  it('builds a PostHog capture request with the user id and no personal data', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_x')
    vi.stubEnv('POSTHOG_HOST', 'https://eu.i.posthog.com/')
    const request = captureRequest('render_started', 'user-1', { tier: 'preview' })!
    expect(request.url).toBe('https://eu.i.posthog.com/capture/')
    expect(request.body).toMatchObject({
      api_key: 'phc_x',
      event: 'render_started',
      distinct_id: 'user-1',
      properties: { tier: 'preview' },
    })
    expect(request.body.uuid).toBeUndefined()
  })

  it('gives events with a dedupe key a stable UUID', () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_x')
    const a = captureRequest('purchase', 'u', {}, 'purchase:in_123')!
    const b = captureRequest('purchase', 'u', {}, 'purchase:in_123')!
    expect(a.body.uuid).toBe(b.body.uuid)
    expect(a.body.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(stableEventId('x')).not.toBe(stableEventId('y'))
  })
})

describe('rate limits config', () => {
  it('has a positive limit and window for every rule', () => {
    for (const [action, rules] of Object.entries(RATE_LIMITS)) {
      for (const [subject, [requests, window]] of Object.entries(rules)) {
        expect(requests, `${action}.${subject}`).toBeGreaterThan(0)
        expect(window, `${action}.${subject}`).toBeGreaterThanOrEqual(60)
      }
    }
  })
})
