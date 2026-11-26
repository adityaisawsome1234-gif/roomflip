import 'server-only'

import { ENTITLEMENTS, type Entitlement, type EntitlementLimits } from '@/lib/config/pricing'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Whether a user is free or paid, which decides watermarks, HD finals and
 * export sizes (see ENTITLEMENTS in src/lib/config/pricing.ts).
 *
 * Paid means: an active subscription (including one in its grace period after
 * a failed payment), or at least one credit pack ever bought.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const db = createAdminClient()
  const [subscription, pack] = await Promise.all([
    db
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing', 'past_due'])
      .gt('current_period_end', new Date().toISOString())
      .limit(1),
    db
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'pack_purchase')
      .limit(1),
  ])
  if (subscription.error || pack.error) {
    throw new Error(`Could not read entitlement: ${(subscription.error ?? pack.error)!.message}`)
  }
  return subscription.data.length > 0 || pack.data.length > 0 ? 'paid' : 'free'
}

export async function getEntitlementLimits(
  userId: string,
): Promise<EntitlementLimits & { entitlement: Entitlement }> {
  const entitlement = await getEntitlement(userId)
  return { entitlement, ...ENTITLEMENTS[entitlement] }
}
