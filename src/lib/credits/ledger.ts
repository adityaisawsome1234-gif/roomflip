import 'server-only'

import { CREDITS, PLANS, type PlanId, type RenderTier } from '@/lib/config/pricing'
import { RENDER_DEADLINE_SECONDS } from '@/lib/config/jobs'
import { renderCostUsd, type ModelSpec } from '@/lib/config/models'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'

/**
 * The only way app code touches credits. Every function here calls one
 * Postgres function from supabase/migrations/*_credits_ledger.sql, which does
 * the work in a single transaction under a per-user lock. There is no stored
 * balance: balances are always summed from the ledger.
 *
 * All functions run with the service role and trust the user id they are
 * given, so callers must pass an id they have verified (getSessionUser).
 */

export type CreditBucket = 'subscription' | 'free' | 'pack'

export interface CreditBalances {
  total: number
  subscription: number
  free: number
  pack: number
}

export type CreditsErrorReason =
  'insufficient_credits' | 'not_found' | 'conflict' | 'invalid_argument' | 'unexpected'

/** A credits operation was refused. `reason` says why; the message is for logs, not people. */
export class CreditsError extends Error {
  constructor(
    readonly reason: CreditsErrorReason,
    message: string,
    readonly details: { balance?: number; required?: number } = {},
  ) {
    super(message)
    this.name = 'CreditsError'
  }
}

const SQLSTATE_REASONS: Record<string, CreditsErrorReason> = {
  RF400: 'invalid_argument',
  RF402: 'insufficient_credits',
  RF404: 'not_found',
  RF409: 'conflict',
}

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string | null
}

function toCreditsError(error: PostgrestLikeError): CreditsError {
  const reason = (error.code && SQLSTATE_REASONS[error.code]) || 'unexpected'
  const details: { balance?: number; required?: number } = {}
  const match = /balance=(-?\d+) required=(\d+)/.exec(error.details ?? '')
  if (match) {
    details.balance = Number(match[1])
    details.required = Number(match[2])
  }
  return new CreditsError(reason, error.message ?? 'credits operation failed', details)
}

function firstRow<T>(rows: T[] | null, what: string): T {
  const row = rows?.[0]
  if (!row) throw new CreditsError('unexpected', `${what} returned no row`)
  return row
}

/** The start of the month `months` after `start`, keeping the day where the month allows. */
function addMonths(start: Date, months: number): Date {
  const result = new Date(start)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/**
 * Plans billed yearly but credited monthly (Pro Annual): grant this month's
 * credits if they are due and not yet granted. The yearly invoice grants
 * month 0 (see the Stripe webhook); this grants months 1 to 11, without
 * rollover. Called whenever a balance is read, and by the daily cron.
 */
export async function grantDuePlanCredits(userId: string, now: Date = new Date()): Promise<number> {
  const { data: subscriptions } = await createAdminClient()
    .from('subscriptions')
    .select('id, plan_id, current_period_start, current_period_end')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due'])
  let granted = 0
  for (const sub of subscriptions ?? []) {
    const plan = PLANS[sub.plan_id as PlanId]
    if (!plan || plan.credits.cadence !== 'monthly') continue
    if (!sub.current_period_start || !sub.current_period_end) continue
    const start = new Date(sub.current_period_start)
    if (now < start || now >= new Date(sub.current_period_end)) continue

    let month = 0
    while (month < 11 && addMonths(start, month + 1) <= now) month++
    if (month === 0) continue

    const created = await grantCredits({
      userId,
      amount: plan.credits.amount,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `sub:${sub.id}:${Math.floor(start.getTime() / 1000)}:m${month}`,
      metadata: { plan: sub.plan_id, subscription: sub.id, month },
      resetBucket: !plan.rollover,
    })
    if (created) granted += plan.credits.amount
  }
  return granted
}

/**
 * The user's balances. Creates the one-time signup grant the first time it is
 * called for a user, so every path that shows or spends credits goes through here.
 */
export async function getCreditBalances(userId: string): Promise<CreditBalances> {
  await grantDuePlanCredits(userId)
  const { data, error } = await createAdminClient().rpc('credits_summary', {
    p_user_id: userId,
    p_signup_grant: CREDITS.signupGrant,
  })
  if (error) throw toCreditsError(error)
  return firstRow(data, 'credits_summary')
}

export interface StartRenderInput {
  userId: string
  roomId: string
  tier: RenderTier
  mode: 'style' | 'paint' | 'material'
  params: Record<string, unknown>
  prompt: string
  model: ModelSpec
  /** How many images the provider request will carry (room photo, swatch, preview). */
  inputImages: number
  /** For an HD final: the preview it is made from. */
  sourceRenderId?: string
  /** Sent by the browser once per tap, so a double tap or a retry never charges twice. */
  clientRequestId?: string
}

export interface StartRenderResult {
  renderId: string
  /** False when the call matched an existing job and nothing was charged. */
  created: boolean
  /** Balance after this call. */
  balance: number
}

/**
 * Create the render row and take its credits in one transaction. Throws a
 * CreditsError with reason "insufficient_credits" when the balance is too low.
 */
export async function startRender(input: StartRenderInput): Promise<StartRenderResult> {
  // Make sure the signup grant exists before the first spend.
  await getCreditBalances(input.userId)

  const { data, error } = await createAdminClient().rpc('start_render', {
    p_user_id: input.userId,
    p_room_id: input.roomId,
    p_tier: input.tier,
    p_mode: input.mode,
    p_params: input.params as Json,
    p_prompt: input.prompt,
    p_provider: input.model.provider,
    p_model: input.model.id,
    p_credits: CREDITS.cost[input.tier],
    p_cost_usd: renderCostUsd(input.model, input.inputImages),
    p_deadline_seconds: RENDER_DEADLINE_SECONDS[input.tier],
    p_source_render_id: input.sourceRenderId,
    p_client_request_id: input.clientRequestId,
  })
  if (error) throw toCreditsError(error)
  const row = firstRow(data, 'start_render')
  return { renderId: row.render_id, created: row.created, balance: row.balance }
}

export interface FailRenderResult {
  /** False when the render had already finished, so nothing changed. */
  changed: boolean
  refunded: number
  balance: number
}

/** Mark an in-flight render failed and refund exactly what it was charged. Idempotent. */
export async function failRender(
  renderId: string,
  errorCode: string,
  errorMessage?: string,
): Promise<FailRenderResult> {
  const { data, error } = await createAdminClient().rpc('fail_render', {
    p_render_id: renderId,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  })
  if (error) throw toCreditsError(error)
  return firstRow(data, 'fail_render')
}

/**
 * Mark an in-flight render succeeded. Returns false when it is no longer in
 * flight (it timed out and was refunded): the late result must then be discarded.
 */
export async function completeRender(input: {
  renderId: string
  resultPath: string
  watermarkedPath: string | null
  width: number
  height: number
}): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('complete_render', {
    p_render_id: input.renderId,
    p_result_path: input.resultPath,
    // The generated type says string; the column and the function accept null.
    p_watermarked_path: input.watermarkedPath as string,
    p_result_width: input.width,
    p_result_height: input.height,
  })
  if (error) throw toCreditsError(error)
  return data === true
}

/**
 * Fail and refund every in-flight render past its deadline. Returns the ids it
 * failed. Each render is handled in its own transaction, so one user's lock is
 * never held while another's is processed, and concurrent sweeps cannot
 * deadlock or double-refund.
 */
export async function failStaleRenders(limit = 100): Promise<string[]> {
  const db = createAdminClient()
  const { data: candidates, error } = await db.rpc('list_stale_renders', { p_limit: limit })
  if (error) throw toCreditsError(error)
  const failed: string[] = []
  for (const renderId of candidates ?? []) {
    const { data: changed, error: failError } = await db.rpc('fail_stale_render', {
      p_render_id: renderId,
    })
    if (failError) throw toCreditsError(failError)
    if (changed) failed.push(renderId)
  }
  return failed
}

export interface GrantCreditsInput {
  userId: string
  amount: number
  kind: 'subscription_grant' | 'pack_purchase' | 'adjustment'
  bucket: CreditBucket
  /** Unique per grant, e.g. the Stripe invoice or checkout session id. Replays are no-ops. */
  idempotencyKey: string
  metadata?: Record<string, unknown>
  /** No rollover: write off what is left in the bucket before adding the new credits. */
  resetBucket?: boolean
}

/** Add credits. Returns false when the idempotency key was already used (a replay). */
export async function grantCredits(input: GrantCreditsInput): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('grant_credits', {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_kind: input.kind,
    p_bucket: input.bucket,
    p_idempotency_key: input.idempotencyKey,
    p_metadata: (input.metadata ?? {}) as Json,
    p_reset_bucket: input.resetBucket ?? false,
  })
  if (error) throw toCreditsError(error)
  return data === true
}

/** Write off what is left in a bucket, e.g. when a subscription ends. Returns credits removed. */
export async function expireCredits(input: {
  userId: string
  bucket: CreditBucket
  idempotencyKey: string
  reason?: string
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc('expire_credits', {
    p_user_id: input.userId,
    p_bucket: input.bucket,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason,
  })
  if (error) throw toCreditsError(error)
  return data ?? 0
}
