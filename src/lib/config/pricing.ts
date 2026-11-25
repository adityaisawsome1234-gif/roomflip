/**
 * Every price, credit amount and plan limit lives in this file.
 * Nothing else in the codebase hard-codes a number of credits or a dollar amount.
 *
 * Stripe price IDs are not here: each purchasable item names the environment
 * variable that holds its Stripe price ID, so test and live mode can differ.
 */

export type RenderTier = 'preview' | 'hd'

export const CREDITS = {
  /** Granted once when an account is created. */
  signupGrant: 3,
  /**
   * What one render costs. A preview (first render or a regeneration) is one
   * credit. Making the HD final from a preview is one more credit on top.
   */
  cost: { preview: 1, hd: 1 } satisfies Record<RenderTier, number>,
} as const

export type PlanId = 'pro_weekly' | 'pro_annual'

export interface Plan {
  id: PlanId
  name: string
  priceUsd: number
  interval: 'week' | 'year'
  /**
   * How credits are granted.
   *   per_invoice: `amount` credits each time a subscription invoice is paid.
   *   monthly:     `amount` credits every month for as long as the term is active.
   */
  credits: { amount: number; cadence: 'per_invoice' | 'monthly' }
  /** When false, unused subscription credits expire when the next grant arrives. */
  rollover: boolean
  /** Name of the env var holding this plan's Stripe price ID. */
  stripePriceEnv: string
}

export const PLANS: Record<PlanId, Plan> = {
  pro_weekly: {
    id: 'pro_weekly',
    name: 'Pro Weekly',
    priceUsd: 6.99,
    interval: 'week',
    credits: { amount: 50, cadence: 'per_invoice' },
    rollover: false,
    stripePriceEnv: 'STRIPE_PRICE_PRO_WEEKLY',
  },
  pro_annual: {
    id: 'pro_annual',
    name: 'Pro Annual',
    priceUsd: 59.99,
    interval: 'year',
    credits: { amount: 100, cadence: 'monthly' },
    rollover: false,
    stripePriceEnv: 'STRIPE_PRICE_PRO_ANNUAL',
  },
}

export type CreditPackId = 'pack_20' | 'pack_60'

export interface CreditPack {
  id: CreditPackId
  name: string
  credits: number
  priceUsd: number
  stripePriceEnv: string
}

/** One-time purchases. Pack credits never expire. */
export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  pack_20: {
    id: 'pack_20',
    name: '20 renders',
    credits: 20,
    priceUsd: 4.99,
    stripePriceEnv: 'STRIPE_PRICE_PACK_20',
  },
  pack_60: {
    id: 'pack_60',
    name: '60 renders',
    credits: 60,
    priceUsd: 9.99,
    stripePriceEnv: 'STRIPE_PRICE_PACK_60',
  },
}

export type Entitlement = 'free' | 'paid'

export interface EntitlementLimits {
  /** Whether images and reels carry the "Made with" watermark. */
  watermark: boolean
  /** Whether the user may spend a credit on the HD final (premium model). */
  hdFinal: boolean
  /** Longest edge, in pixels, of images the user can view and download. */
  maxImageEdgePx: number
  /** Output size of the exported 9:16 reel. */
  reel: { width: number; height: number }
}

/**
 * What each kind of user gets. "paid" means an active subscription or at least
 * one credit pack purchase; everyone else is "free".
 */
export const ENTITLEMENTS: Record<Entitlement, EntitlementLimits> = {
  free: {
    watermark: true,
    hdFinal: false,
    maxImageEdgePx: 1024,
    reel: { width: 720, height: 1280 },
  },
  paid: {
    watermark: false,
    hdFinal: true,
    maxImageEdgePx: 4096,
    reel: { width: 1080, height: 1920 },
  },
}

/** "$6.99" style formatting for prices shown in the UI. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}
