import 'server-only'

import type { SessionUser } from '@/lib/auth/session'
import { ROUTES } from '@/lib/config/site'
import { publicEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlanId, type PurchasableId } from './items'
import { getStripe, priceIdFor } from './stripe'

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BillingError'
  }
}

/** The user's Stripe customer id, creating the customer on first purchase. */
export async function ensureCustomer(user: SessionUser): Promise<string> {
  const db = createAdminClient()
  const existing = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing.data) return existing.data.stripe_customer_id

  const customer = await getStripe().customers.create(
    { email: user.email ?? undefined, metadata: { user_id: user.id } },
    // Two quick taps create one customer.
    { idempotencyKey: `customer:${user.id}` },
  )
  await db
    .from('billing_customers')
    .upsert(
      { user_id: user.id, stripe_customer_id: customer.id },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
  const stored = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()
  return stored.data!.stripe_customer_id
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
    .gt('current_period_end', new Date().toISOString())
    .limit(1)
  return (data?.length ?? 0) > 0
}

/** Start Stripe Checkout for a plan or a credit pack. Returns the URL to send the browser to. */
export async function createCheckoutSession(
  user: SessionUser,
  item: PurchasableId,
  returnPath: string,
): Promise<string> {
  const plan = isPlanId(item)
  if (plan && (await hasActiveSubscription(user.id))) {
    throw new BillingError(
      409,
      'already_subscribed',
      'You already have Pro. Manage it from your account.',
    )
  }
  const customer = await ensureCustomer(user)
  const site = publicEnv.siteUrl
  const metadata = { user_id: user.id, item }

  const session = await getStripe().checkout.sessions.create({
    mode: plan ? 'subscription' : 'payment',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: priceIdFor(item), quantity: 1 }],
    metadata,
    // Copied onto the subscription and its invoices, so webhooks can find the user.
    ...(plan
      ? { subscription_data: { metadata: { user_id: user.id, plan_id: item } } }
      : { payment_intent_data: { metadata } }),
    allow_promotion_codes: true,
    success_url: `${site}${ROUTES.account}?checkout=success`,
    cancel_url: `${site}${returnPath}`,
  })
  if (!session.url) throw new BillingError(502, 'checkout_failed', 'Checkout could not start.')
  return session.url
}

/** Open Stripe's customer portal (change plan, update card, cancel, invoices). */
export async function createPortalSession(user: SessionUser): Promise<string> {
  const { data } = await createAdminClient()
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data) throw new BillingError(404, 'no_customer', 'There is nothing to manage yet.')
  const session = await getStripe().billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${publicEnv.siteUrl}${ROUTES.account}`,
  })
  return session.url
}
