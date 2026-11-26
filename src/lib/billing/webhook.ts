import 'server-only'

import type Stripe from 'stripe'
import { trackLater } from '@/lib/analytics'
import { CREDIT_PACKS, PLANS, type PlanId } from '@/lib/config/pricing'
import { expireCredits, grantCredits } from '@/lib/credits/ledger'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPackId, isPlanId } from './items'
import { itemForPriceId } from './stripe'

/**
 * Turns Stripe webhook events into credits and plan records.
 *
 * Every action is idempotent, because Stripe delivers events at least once
 * and in no guaranteed order:
 *   - credits are granted with idempotency keys derived from Stripe ids
 *     (checkout session, invoice, subscription period);
 *   - subscription and payment rows are upserts keyed by Stripe ids.
 *
 * Events handled:
 *   checkout.session.completed / async_payment_succeeded  pack credits
 *   invoice.paid                                          plan credits, payment record
 *   customer.subscription.created / updated / deleted      plan status; credits end with the plan
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

/** The app user a Stripe object belongs to: from our metadata, else from the customer. */
async function resolveUser(
  metadataUserId: string | null | undefined,
  customerId: string | null,
): Promise<string | null> {
  const db = createAdminClient()
  if (metadataUserId && UUID.test(metadataUserId)) {
    const { data } = await db.from('profiles').select('id').eq('id', metadataUserId).maybeSingle()
    if (data) return data.id
  }
  if (customerId) {
    const { data } = await db
      .from('billing_customers')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (data) return data.user_id
  }
  return null
}

async function rememberCustomer(userId: string, customerId: string | null) {
  if (!customerId) return
  await createAdminClient()
    .from('billing_customers')
    .upsert(
      { user_id: userId, stripe_customer_id: customerId },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<string> {
  const customerId = idOf(session.customer)
  const userId = await resolveUser(
    session.client_reference_id ?? session.metadata?.user_id,
    customerId,
  )
  if (!userId) return 'ignored: unknown user'
  await rememberCustomer(userId, customerId)

  // Plans are credited from invoice.paid, which covers renewals too.
  if (session.mode !== 'payment') return 'ok: subscription checkout'
  if (session.payment_status !== 'paid') return 'ignored: not paid yet'

  const item = session.metadata?.item ?? ''
  if (!isPackId(item)) return `ignored: unknown pack ${item}`
  const pack = CREDIT_PACKS[item]

  await grantCredits({
    userId,
    amount: pack.credits,
    kind: 'pack_purchase',
    bucket: 'pack',
    idempotencyKey: `checkout:${session.id}`,
    metadata: { pack: item, checkout_session: session.id },
  })
  await createAdminClient()
    .from('payments')
    .upsert(
      {
        id: session.id,
        user_id: userId,
        kind: 'pack',
        item_id: item,
        amount_cents: session.amount_total ?? 0,
        currency: (session.currency ?? 'usd').toLowerCase(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
  trackLater(
    'purchase',
    userId,
    {
      kind: 'pack',
      item,
      amount: (session.amount_total ?? 0) / 100,
      currency: session.currency ?? 'usd',
    },
    `purchase:${session.id}`,
  )
  return `ok: ${pack.credits} pack credits`
}

/** Plan of a subscription, from its price, falling back to the metadata we set at checkout. */
function planOf(
  priceId: string | null | undefined,
  metadataPlan: string | null | undefined,
): PlanId | null {
  const fromPrice = itemForPriceId(priceId)
  if (fromPrice && isPlanId(fromPrice)) return fromPrice
  return metadataPlan && isPlanId(metadataPlan) ? metadataPlan : null
}

async function onInvoicePaid(invoice: Stripe.Invoice): Promise<string> {
  const details = invoice.parent?.subscription_details
  const subscriptionId = idOf(details?.subscription)
  if (!subscriptionId) return 'ignored: not a subscription invoice'

  const customerId = idOf(invoice.customer)
  const userId = await resolveUser(details?.metadata?.user_id, customerId)
  if (!userId) return 'ignored: unknown user'
  await rememberCustomer(userId, customerId)

  const line =
    invoice.lines.data.find((l) => l.pricing?.price_details?.price) ?? invoice.lines.data[0]
  const priceId = idOf(line?.pricing?.price_details?.price as string | { id: string } | undefined)
  const planId = planOf(priceId, details?.metadata?.plan_id)
  if (!planId) return `ignored: unknown plan for price ${priceId}`
  const plan = PLANS[planId]
  const periodStart = line?.period?.start ?? invoice.period_start
  const periodEnd = line?.period?.end ?? invoice.period_end

  const db = createAdminClient()
  // The invoice can arrive before customer.subscription.created; make sure the plan is on record.
  await db.from('subscriptions').upsert(
    {
      id: subscriptionId,
      user_id: userId,
      plan_id: planId,
      status: 'active',
      current_period_start: toIso(periodStart),
      current_period_end: toIso(periodEnd),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )

  // Weekly: every paid invoice brings the week's credits. Annual: the yearly
  // invoice brings the first month's; later months come from grantDuePlanCredits.
  const idempotencyKey =
    plan.credits.cadence === 'per_invoice'
      ? `invoice:${invoice.id}`
      : `sub:${subscriptionId}:${periodStart}:m0`
  await grantCredits({
    userId,
    amount: plan.credits.amount,
    kind: 'subscription_grant',
    bucket: 'subscription',
    idempotencyKey,
    metadata: { plan: planId, invoice: invoice.id, subscription: subscriptionId },
    resetBucket: !plan.rollover,
  })

  await db.from('payments').upsert(
    {
      id: invoice.id,
      user_id: userId,
      kind: 'subscription',
      item_id: planId,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency.toLowerCase(),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  trackLater(
    'purchase',
    userId,
    {
      kind: 'subscription',
      item: planId,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency,
      renewal: invoice.billing_reason === 'subscription_cycle',
    },
    `purchase:${invoice.id}`,
  )
  return `ok: ${plan.credits.amount} plan credits`
}

async function onSubscriptionChanged(
  subscription: Stripe.Subscription,
  deleted: boolean,
): Promise<string> {
  const customerId = idOf(subscription.customer)
  const userId = await resolveUser(subscription.metadata?.user_id, customerId)
  if (!userId) return 'ignored: unknown user'
  await rememberCustomer(userId, customerId)

  const item = subscription.items.data[0]
  const planId = planOf(item?.price?.id, subscription.metadata?.plan_id)
  if (!planId) return `ignored: unknown plan for price ${item?.price?.id}`

  await createAdminClient()
    .from('subscriptions')
    .upsert(
      {
        id: subscription.id,
        user_id: userId,
        plan_id: planId,
        status: subscription.status,
        current_period_start: toIso(item?.current_period_start),
        current_period_end: toIso(item?.current_period_end),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: toIso(subscription.canceled_at),
        ended_at: toIso(subscription.ended_at),
      },
      { onConflict: 'id' },
    )

  if (
    deleted ||
    subscription.status === 'canceled' ||
    subscription.status === 'incomplete_expired'
  ) {
    // Plan credits end with the plan. Free and purchased credits are untouched.
    const removed = await expireCredits({
      userId,
      bucket: 'subscription',
      idempotencyKey: `sub-end:${subscription.id}`,
      reason: 'plan_ended',
    })
    return `ok: plan ended, ${removed} plan credits removed`
  }
  return `ok: plan ${subscription.status}`
}

/** Apply one verified Stripe event. Returns a short note for the event log. */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return onCheckoutCompleted(event.data.object)
    case 'invoice.paid':
      return onInvoicePaid(event.data.object)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return onSubscriptionChanged(event.data.object, false)
    case 'customer.subscription.deleted':
      return onSubscriptionChanged(event.data.object, true)
    default:
      return `ignored: ${event.type}`
  }
}

/**
 * Record and apply an event once. A redelivery of an event already applied is
 * acknowledged without doing anything; a failed one is retried.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<'processed' | 'duplicate'> {
  const db = createAdminClient()
  const { data: existing } = await db
    .from('stripe_events')
    .select('status')
    .eq('id', event.id)
    .maybeSingle()
  if (existing?.status === 'processed') return 'duplicate'
  if (!existing) {
    await db
      .from('stripe_events')
      .upsert(
        { id: event.id, type: event.type, status: 'processing' },
        { onConflict: 'id', ignoreDuplicates: true },
      )
  }

  try {
    const note = await handleStripeEvent(event)
    await db
      .from('stripe_events')
      .update({
        status: 'processed',
        error: note.slice(0, 500),
        processed_at: new Date().toISOString(),
      })
      .eq('id', event.id)
    return 'processed'
  } catch (error) {
    await db
      .from('stripe_events')
      .update({ status: 'failed', error: (error as Error).message.slice(0, 500) })
      .eq('id', event.id)
    throw error
  }
}
