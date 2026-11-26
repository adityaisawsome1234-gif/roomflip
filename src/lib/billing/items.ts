import { CREDIT_PACKS, PLANS, type CreditPackId, type PlanId } from '@/lib/config/pricing'

/** Everything that can be bought, by the id used in checkout requests. */
export type PurchasableId = PlanId | CreditPackId

export const PURCHASABLE_IDS = [
  ...Object.keys(PLANS),
  ...Object.keys(CREDIT_PACKS),
] as PurchasableId[]

export function isPlanId(id: string): id is PlanId {
  return Object.hasOwn(PLANS, id)
}

export function isPackId(id: string): id is CreditPackId {
  return Object.hasOwn(CREDIT_PACKS, id)
}

export function isPurchasableId(id: string): id is PurchasableId {
  return isPlanId(id) || isPackId(id)
}
