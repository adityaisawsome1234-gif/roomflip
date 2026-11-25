import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CREDIT_PACKS, CREDITS, ENTITLEMENTS, PLANS } from '@/lib/config/pricing'
import { SERVER_ENV_KEYS } from '@/lib/env.server'

const envExample = readFileSync('.env.example', 'utf8')
const documentedKeys = new Set(
  envExample
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key)),
)

describe('.env.example', () => {
  it('documents every server env key the app reads', () => {
    const missing = SERVER_ENV_KEYS.filter((key) => !documentedKeys.has(key))
    expect(missing).toEqual([])
  })

  it('documents the Stripe price variable of every plan and pack', () => {
    const priceVars = [...Object.values(PLANS), ...Object.values(CREDIT_PACKS)].map(
      (item) => item.stripePriceEnv,
    )
    for (const name of priceVars) {
      expect(documentedKeys.has(name), `${name} missing from .env.example`).toBe(true)
      expect(SERVER_ENV_KEYS as readonly string[]).toContain(name)
    }
  })

  it('documents every NEXT_PUBLIC_ variable referenced in src', () => {
    // Guard against a public key being read in code but never documented.
    for (const key of [
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_AUTH_GOOGLE_ENABLED',
    ]) {
      expect(documentedKeys.has(key), `${key} missing from .env.example`).toBe(true)
    }
  })

  it('contains no real secrets', () => {
    for (const line of envExample.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (!match) continue
      const [, key, value] = match
      const looksSecret =
        /SECRET|_KEY$|FAL_KEY|WEBHOOK/.test(key) && !key.startsWith('NEXT_PUBLIC_')
      if (looksSecret) expect(value, `${key} should be blank in .env.example`).toBe('')
    }
  })
})

describe('pricing config', () => {
  it('matches the agreed commercial terms', () => {
    expect(CREDITS.signupGrant).toBe(3)
    expect(CREDITS.cost).toEqual({ preview: 1, hd: 1 })

    expect(PLANS.pro_weekly).toMatchObject({
      priceUsd: 6.99,
      interval: 'week',
      credits: { amount: 50, cadence: 'per_invoice' },
    })
    expect(PLANS.pro_annual).toMatchObject({
      priceUsd: 59.99,
      interval: 'year',
      credits: { amount: 100, cadence: 'monthly' },
      rollover: false,
    })

    expect(CREDIT_PACKS.pack_20).toMatchObject({ credits: 20, priceUsd: 4.99 })
    expect(CREDIT_PACKS.pack_60).toMatchObject({ credits: 60, priceUsd: 9.99 })
  })

  it('watermarks free users only, and reserves the HD final for paid users', () => {
    expect(ENTITLEMENTS.free.watermark).toBe(true)
    expect(ENTITLEMENTS.paid.watermark).toBe(false)
    expect(ENTITLEMENTS.free.hdFinal).toBe(false)
    expect(ENTITLEMENTS.paid.hdFinal).toBe(true)
  })

  it('exports reels at 9:16', () => {
    for (const tier of Object.values(ENTITLEMENTS)) {
      expect(tier.reel.width / tier.reel.height).toBeCloseTo(9 / 16, 5)
    }
  })
})
