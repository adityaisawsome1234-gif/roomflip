import { z } from 'zod'
import { apiUser, json, jsonError } from '@/lib/api'
import { safeNextPath } from '@/lib/auth/redirects'
import { BillingError, createCheckoutSession } from '@/lib/billing/checkout'
import { isPurchasableId } from '@/lib/billing/items'
import { ROUTES } from '@/lib/config/site'

const bodySchema = z
  .object({
    item: z.string().refine(isPurchasableId),
    /** Where to come back to if checkout is cancelled. */
    returnPath: z.string().optional(),
  })
  .strict()

/** Start Stripe Checkout for a plan or pack. Returns { url } to redirect to. */
export async function POST(request: Request) {
  const user = await apiUser()
  if (user instanceof Response) return user

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Unknown plan or pack.')

  try {
    const url = await createCheckoutSession(
      user,
      parsed.data.item as Parameters<typeof createCheckoutSession>[1],
      safeNextPath(parsed.data.returnPath, ROUTES.account),
    )
    return json({ url })
  } catch (error) {
    if (error instanceof BillingError) return jsonError(error.status, error.code, error.message)
    console.error('[billing] checkout failed:', (error as Error).message)
    return jsonError(502, 'checkout_failed', "Checkout didn't open. Try again in a moment.")
  }
}
