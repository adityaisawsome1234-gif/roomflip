import type Stripe from 'stripe'
import { getStripe } from '@/lib/billing/stripe'
import { processStripeEvent } from '@/lib/billing/webhook'
import { serverEnv } from '@/lib/env.server'

export const maxDuration = 30

/**
 * Stripe webhook. The signature is verified against the raw body before
 * anything else. A processing error returns 500 so Stripe retries; every
 * action is idempotent, so retries and duplicate deliveries are safe.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('missing signature', { status: 400 })
  const body = await request.text()

  let event: Stripe.Event
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      signature,
      serverEnv('STRIPE_WEBHOOK_SECRET'),
    )
  } catch {
    return new Response('invalid signature', { status: 400 })
  }

  try {
    const outcome = await processStripeEvent(event)
    return Response.json({ received: true, outcome })
  } catch (error) {
    console.error('[webhooks/stripe] failed:', event.type, event.id, (error as Error).message)
    return new Response('processing failed', { status: 500 })
  }
}
