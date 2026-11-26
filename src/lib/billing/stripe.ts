import 'server-only'

import Stripe from 'stripe'
import { CREDIT_PACKS, PLANS } from '@/lib/config/pricing'
import { optionalServerEnv, serverEnv, type ServerEnvKey } from '@/lib/env.server'
import { isPackId, isPlanId, type PurchasableId } from './items'

let client: Stripe | null = null

/**
 * The Stripe client. STRIPE_API_BASE (tests only) points it at stripe-mock;
 * it is ignored in production so a stray value can never redirect payments.
 */
export function getStripe(): Stripe {
  if (client) return client
  const base =
    process.env.NODE_ENV !== 'production' ? optionalServerEnv('STRIPE_API_BASE') : undefined
  const options: Stripe.StripeConfig = { appInfo: { name: 'RoomFlip' }, maxNetworkRetries: 2 }
  if (base) {
    const url = new URL(base)
    options.host = url.hostname
    options.port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    options.protocol = url.protocol.replace(':', '') as 'http' | 'https'
  }
  client = new Stripe(serverEnv('STRIPE_SECRET_KEY'), options)
  return client
}

/** The Stripe price id configured for a plan or pack. */
export function priceIdFor(item: PurchasableId): string {
  const envKey = (isPlanId(item) ? PLANS[item] : CREDIT_PACKS[item]).stripePriceEnv
  return serverEnv(envKey as ServerEnvKey)
}

/** Which plan or pack a Stripe price id belongs to, if any. */
export function itemForPriceId(priceId: string | null | undefined): PurchasableId | null {
  if (!priceId) return null
  for (const id of [...Object.keys(PLANS), ...Object.keys(CREDIT_PACKS)]) {
    if (!isPlanId(id) && !isPackId(id)) continue
    const envKey = (isPlanId(id) ? PLANS[id] : CREDIT_PACKS[id]).stripePriceEnv as ServerEnvKey
    if (optionalServerEnv(envKey) === priceId) return id
  }
  return null
}
