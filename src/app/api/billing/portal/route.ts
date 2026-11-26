import { apiUser, json, jsonError } from '@/lib/api'
import { BillingError, createPortalSession } from '@/lib/billing/checkout'

/** Open Stripe's customer portal. Returns { url } to redirect to. */
export async function POST() {
  const user = await apiUser()
  if (user instanceof Response) return user
  try {
    return json({ url: await createPortalSession(user) })
  } catch (error) {
    if (error instanceof BillingError) return jsonError(error.status, error.code, error.message)
    console.error('[billing] portal failed:', (error as Error).message)
    return jsonError(502, 'portal_failed', "Billing settings didn't open. Try again in a moment.")
  }
}
