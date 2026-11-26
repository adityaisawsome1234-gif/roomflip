import 'server-only'

import { ENTITLEMENTS, type Entitlement, type EntitlementLimits } from '@/lib/config/pricing'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Whether a user is free or paid, which decides watermarks, HD finals and
 * export sizes (see ENTITLEMENTS in src/lib/config/pricing.ts).
 *
 * Paid means: has ever bought a credit pack, or has an active subscription.
 * Until Stripe subscriptions are stored (milestone 6), "active subscription"
 * is read from the ledger as a plan grant in the last 35 days, which covers a
 * weekly plan and a monthly grant of the annual plan.
 */
const SUBSCRIPTION_GRACE_DAYS = 35

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const since = new Date(Date.now() - SUBSCRIPTION_GRACE_DAYS * 86_400_000).toISOString()
  const { data, error } = await createAdminClient()
    .from('credit_ledger')
    .select('kind, created_at')
    .eq('user_id', userId)
    .in('kind', ['pack_purchase', 'subscription_grant'])
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`Could not read entitlement: ${error.message}`)

  const paid = (data ?? []).some((row) => row.kind === 'pack_purchase' || row.created_at >= since)
  return paid ? 'paid' : 'free'
}

export async function getEntitlementLimits(
  userId: string,
): Promise<EntitlementLimits & { entitlement: Entitlement }> {
  const entitlement = await getEntitlement(userId)
  return { entitlement, ...ENTITLEMENTS[entitlement] }
}
