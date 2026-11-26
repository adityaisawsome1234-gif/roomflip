import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, describe, expect, it } from 'vitest'
import { processStripeEvent } from '@/lib/billing/webhook'
import { getEntitlement } from '@/lib/credits/entitlement'
import { getCreditBalances, grantDuePlanCredits, startRender } from '@/lib/credits/ledger'
import { MODELS } from '@/lib/config/models'
import { createUser, deleteCreatedUsers, insertRoom, serviceClient } from '../helpers/db'

/**
 * Stripe webhook handling, end to end against the real database: credits,
 * subscription records, payment records and the event log. Events are built
 * in the shape of the API version the SDK pins (subscription on
 * invoice.parent.subscription_details, price on line.pricing.price_details).
 */

afterAll(deleteCreatedUsers)

const PRICE = {
  weekly: process.env.STRIPE_PRICE_PRO_WEEKLY!,
  annual: process.env.STRIPE_PRICE_PRO_ANNUAL!,
}
const now = () => Math.floor(Date.now() / 1000)
const DAY = 86_400

function event<T>(type: string, object: T, id = `evt_${randomUUID()}`): Stripe.Event {
  return { id, type, object: 'event', data: { object } } as unknown as Stripe.Event
}

function packCheckout(userId: string, item: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${randomUUID()}`,
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    client_reference_id: userId,
    customer: `cus_${userId.slice(0, 8)}`,
    metadata: { user_id: userId, item },
    amount_total: item === 'pack_60' ? 999 : 499,
    currency: 'usd',
    ...overrides,
  }
}

function invoice(
  userId: string,
  subscriptionId: string,
  price: string,
  start: number,
  end: number,
  planId: string,
) {
  return {
    id: `in_${randomUUID()}`,
    object: 'invoice',
    customer: `cus_${userId.slice(0, 8)}`,
    amount_paid: planId === 'pro_weekly' ? 699 : 5999,
    currency: 'usd',
    period_start: start,
    period_end: end,
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: subscriptionId,
        metadata: { user_id: userId, plan_id: planId },
      },
    },
    lines: {
      data: [
        {
          period: { start, end },
          pricing: { type: 'price_details', price_details: { price, product: 'prod_x' } },
        },
      ],
    },
  }
}

function subscription(
  userId: string,
  id: string,
  price: string,
  start: number,
  end: number,
  status = 'active',
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    object: 'subscription',
    customer: `cus_${userId.slice(0, 8)}`,
    status,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    metadata: { user_id: userId },
    items: {
      data: [{ price: { id: price }, current_period_start: start, current_period_end: end }],
    },
    ...extra,
  }
}

async function balances(userId: string) {
  return getCreditBalances(userId)
}

async function eventLog(id: string) {
  const { data } = await serviceClient()
    .from('stripe_events')
    .select('status, error')
    .eq('id', id)
    .single()
  return data
}

describe('credit pack purchases', () => {
  it('grants the pack once, records the payment, and makes the user paid', async () => {
    const user = await createUser('pack')
    expect(await getEntitlement(user.id)).toBe('free')
    const session = packCheckout(user.id, 'pack_20')
    const completed = event('checkout.session.completed', session)

    expect(await processStripeEvent(completed)).toBe('processed')
    expect(await balances(user.id)).toMatchObject({ pack: 20, free: 3, total: 23 })
    expect(await getEntitlement(user.id)).toBe('paid')

    // The same event again, and a second event about the same session: no more credits.
    expect(await processStripeEvent(completed)).toBe('duplicate')
    await processStripeEvent(event('checkout.session.async_payment_succeeded', session))
    expect((await balances(user.id)).pack).toBe(20)

    const { data: payment } = await serviceClient()
      .from('payments')
      .select('*')
      .eq('id', session.id)
      .single()
    expect(payment).toMatchObject({
      user_id: user.id,
      kind: 'pack',
      item_id: 'pack_20',
      amount_cents: 499,
    })
    expect(await eventLog(completed.id)).toMatchObject({ status: 'processed' })
  })

  it('grants nothing for an unpaid checkout, an unknown pack or an unknown user', async () => {
    const user = await createUser('pack-no')
    await processStripeEvent(
      event(
        'checkout.session.completed',
        packCheckout(user.id, 'pack_20', { payment_status: 'unpaid' }),
      ),
    )
    await processStripeEvent(
      event('checkout.session.completed', packCheckout(user.id, 'pack_9000')),
    )
    const stranger = event(
      'checkout.session.completed',
      packCheckout(randomUUID(), 'pack_60', { customer: 'cus_nobody' }),
    )
    await processStripeEvent(stranger)

    expect((await balances(user.id)).pack).toBe(0)
    expect(await eventLog(stranger.id)).toMatchObject({
      status: 'processed',
      error: 'ignored: unknown user',
    })
  })

  it('pays 60 credits for the larger pack', async () => {
    const user = await createUser('pack60')
    await processStripeEvent(event('checkout.session.completed', packCheckout(user.id, 'pack_60')))
    expect((await balances(user.id)).pack).toBe(60)
  })
})

describe('Pro Weekly', () => {
  it('grants 50 credits per paid invoice with no rollover, and ends with the plan', async () => {
    const user = await createUser('weekly')
    const room = await insertRoom(user.id)
    const subId = `sub_${randomUUID()}`
    const t0 = now()

    // Stripe does not promise order: the invoice can arrive before the subscription event.
    await processStripeEvent(
      event('invoice.paid', invoice(user.id, subId, PRICE.weekly, t0, t0 + 7 * DAY, 'pro_weekly')),
    )
    await processStripeEvent(
      event(
        'customer.subscription.created',
        subscription(user.id, subId, PRICE.weekly, t0, t0 + 7 * DAY),
      ),
    )
    expect(await balances(user.id)).toMatchObject({ subscription: 50, free: 3 })
    expect(await getEntitlement(user.id)).toBe('paid')

    // Spend 5 plan credits, then the next week's invoice: back to 50, not 95.
    for (let i = 0; i < 5; i++) {
      await startRender({
        userId: user.id,
        roomId: room.id,
        tier: 'preview',
        mode: 'style',
        params: {},
        prompt: 'p',
        model: MODELS.mock,
        inputImages: 1,
      })
    }
    expect((await balances(user.id)).subscription).toBe(45)
    const renewal = invoice(user.id, subId, PRICE.weekly, t0 + 7 * DAY, t0 + 14 * DAY, 'pro_weekly')
    await processStripeEvent(event('invoice.paid', renewal))
    expect((await balances(user.id)).subscription).toBe(50)
    // A redelivery under a new event id changes nothing.
    await processStripeEvent(event('invoice.paid', renewal))
    expect((await balances(user.id)).subscription).toBe(50)

    const { data: payments } = await serviceClient()
      .from('payments')
      .select('amount_cents')
      .eq('user_id', user.id)
    expect(payments).toHaveLength(2)

    // Cancelled at period end, then ended.
    await processStripeEvent(
      event(
        'customer.subscription.updated',
        subscription(user.id, subId, PRICE.weekly, t0, t0 + 14 * DAY, 'active', {
          cancel_at_period_end: true,
        }),
      ),
    )
    const { data: sub } = await serviceClient()
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .single()
    expect(sub).toMatchObject({
      plan_id: 'pro_weekly',
      status: 'active',
      cancel_at_period_end: true,
    })

    await processStripeEvent(
      event(
        'customer.subscription.deleted',
        subscription(user.id, subId, PRICE.weekly, t0, t0 + 14 * DAY, 'canceled', {
          ended_at: now(),
        }),
      ),
    )
    expect(await balances(user.id)).toMatchObject({ subscription: 0, free: 3 })
    expect(await getEntitlement(user.id)).toBe('free')
  })

  it('keeps purchased credits when the plan ends', async () => {
    const user = await createUser('weekly-pack')
    const subId = `sub_${randomUUID()}`
    const t0 = now()
    await processStripeEvent(event('checkout.session.completed', packCheckout(user.id, 'pack_20')))
    await processStripeEvent(
      event('invoice.paid', invoice(user.id, subId, PRICE.weekly, t0, t0 + 7 * DAY, 'pro_weekly')),
    )
    await processStripeEvent(
      event(
        'customer.subscription.deleted',
        subscription(user.id, subId, PRICE.weekly, t0, t0 + 7 * DAY, 'canceled'),
      ),
    )
    expect(await balances(user.id)).toMatchObject({ subscription: 0, pack: 20 })
    // Still paid: they bought a pack.
    expect(await getEntitlement(user.id)).toBe('paid')
  })
})

describe('Pro Annual', () => {
  it('grants 100 credits a month for twelve months, without rollover', async () => {
    const user = await createUser('annual')
    const subId = `sub_${randomUUID()}`
    const start = now() - 60
    const end = start + 365 * DAY
    await processStripeEvent(
      event(
        'customer.subscription.created',
        subscription(user.id, subId, PRICE.annual, start, end),
      ),
    )
    await processStripeEvent(
      event('invoice.paid', invoice(user.id, subId, PRICE.annual, start, end, 'pro_annual')),
    )
    expect((await balances(user.id)).subscription).toBe(100)

    const at = (days: number) => new Date((start + days * DAY) * 1000)
    // Nothing new within the first month.
    expect(await grantDuePlanCredits(user.id, at(20))).toBe(0)
    // Month 2 begins: a fresh 100, once.
    expect(await grantDuePlanCredits(user.id, at(32))).toBe(100)
    expect(await grantDuePlanCredits(user.id, at(33))).toBe(0)
    expect((await balances(user.id)).subscription).toBe(100)
    // Month 12, then after the year: nothing more.
    expect(await grantDuePlanCredits(user.id, at(340))).toBe(100)
    expect(await grantDuePlanCredits(user.id, at(366))).toBe(0)
  })
})

describe('the event log', () => {
  it('records unhandled event types as processed and ignored', async () => {
    const ignored = event('customer.created', { id: 'cus_x' })
    expect(await processStripeEvent(ignored)).toBe('processed')
    expect(await eventLog(ignored.id)).toMatchObject({
      status: 'processed',
      error: 'ignored: customer.created',
    })
  })
})
