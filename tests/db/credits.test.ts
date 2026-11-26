import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { MODELS } from '@/lib/config/models'
import { CREDITS } from '@/lib/config/pricing'
import {
  completeRender,
  CreditsError,
  expireCredits,
  failRender,
  failStaleRenders,
  getCreditBalances,
  grantCredits,
  startRender,
  type StartRenderInput,
} from '@/lib/credits/ledger'
import {
  anonClient,
  createUser,
  DB_URL,
  deleteCreatedUsers,
  insertRender,
  insertRoom,
  serviceClient,
  sql,
} from '../helpers/db'

afterAll(deleteCreatedUsers)

/** A signed-up user with a room, ready to render. */
async function setup(label: string) {
  const user = await createUser(label)
  const room = await insertRoom(user.id)
  const preview = (overrides: Partial<StartRenderInput> = {}): StartRenderInput => ({
    userId: user.id,
    roomId: room.id,
    tier: 'preview',
    mode: 'style',
    params: { preset: 'japandi' },
    prompt: 'restyle prompt',
    model: MODELS.mock,
    inputImages: 1,
    ...overrides,
  })
  return { user, room, preview }
}

async function ledger(userId: string) {
  return sql<{ amount: number; bucket: string; kind: string; render_id: string | null }>(
    'select amount, bucket, kind, render_id from public.credit_ledger where user_id = $1 order by id',
    [userId],
  )
}

async function renderRow(id: string) {
  const { data, error } = await serviceClient().from('renders').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

/** Run an operation and return the CreditsError reason it throws, or 'ok'. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (error) {
    if (error instanceof CreditsError) return error.reason
    throw error
  }
}

describe('signup grant', () => {
  it(`gives ${CREDITS.signupGrant} free credits once, however often and concurrently it is read`, async () => {
    const { user } = await setup('signup')
    const results = await Promise.all(Array.from({ length: 10 }, () => getCreditBalances(user.id)))
    for (const balances of results) {
      expect(balances).toEqual({ total: 3, subscription: 0, free: 3, pack: 0 })
    }
    expect(await ledger(user.id)).toEqual([
      { amount: 3, bucket: 'free', kind: 'signup_grant', render_id: null },
    ])
  })
})

describe('starting a render', () => {
  it('creates the job and debits one credit in the same step', async () => {
    const { user, preview } = await setup('start')
    const model = MODELS['seedream-5-flash-edit']
    const started = await startRender(preview({ model }))

    expect(started).toMatchObject({ created: true, balance: 2 })
    const row = await renderRow(started.renderId)
    expect(row).toMatchObject({
      status: 'queued',
      tier: 'preview',
      credits_charged: 1,
      provider: 'fal',
      model: model.id,
    })
    expect(Number(row.cost_usd)).toBe(model.costUsd)
    expect(new Date(row.deadline_at!).getTime()).toBeGreaterThan(Date.now())
    expect((await getCreditBalances(user.id)).total).toBe(2)
  })

  it('refuses a render the balance cannot pay for, and creates nothing', async () => {
    const { user, preview } = await setup('broke')
    for (let i = 0; i < 3; i++) await startRender(preview())

    let error: unknown
    try {
      await startRender(preview())
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CreditsError)
    expect(error).toMatchObject({
      reason: 'insufficient_credits',
      details: { balance: 0, required: 1 },
    })

    const { data } = await serviceClient().from('renders').select('id').eq('user_id', user.id)
    expect(data).toHaveLength(3)
    expect((await getCreditBalances(user.id)).total).toBe(0)
  })

  it('cannot be double-spent by parallel requests', async () => {
    const { user, preview } = await setup('race')
    await getCreditBalances(user.id)

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => outcome(() => startRender(preview()))),
    )
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3)
    expect(outcomes.filter((o) => o === 'insufficient_credits')).toHaveLength(17)

    const rows = await ledger(user.id)
    expect(rows.filter((r) => r.kind === 'render_debit')).toHaveLength(3)
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(0)
    const { data } = await serviceClient().from('renders').select('id').eq('user_id', user.id)
    expect(data).toHaveLength(3)
  })

  it('makes a second spend wait for the first and then re-check the balance', async () => {
    // Deterministic version of the race above: transaction A spends the last
    // credit and stays open, then B tries to spend. B must block on the per-user
    // lock and, once A commits, see the new balance and be refused. Without the
    // lock B would read the old balance and both would succeed.
    const { user, room, preview } = await setup('lock')
    await startRender(preview())
    await startRender(preview()) // one credit left

    const call = `select * from public.start_render($1, $2, 'preview', 'style', '{}'::jsonb,
      'p', 'mock', 'mock', 1, 0, 120)`
    const a = new pg.Client({ connectionString: DB_URL })
    const b = new pg.Client({ connectionString: DB_URL })
    await a.connect()
    await b.connect()
    try {
      await a.query('begin')
      await a.query('set local role service_role')
      await a.query(call, [user.id, room.id])

      await b.query("set statement_timeout = '10s'")
      await b.query('set role service_role')
      let bFinished = false
      const bResult = b.query(call, [user.id, room.id]).then(
        () => ({ ok: true as const }),
        (error: { code?: string }) => ({ ok: false as const, code: error.code }),
      )
      void bResult.then(() => (bFinished = true))

      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(bFinished, 'B must wait while A holds the lock').toBe(false)

      await a.query('commit')
      expect(await bResult).toEqual({ ok: false, code: 'RF402' })
    } finally {
      await a.end()
      await b.end()
    }
    expect((await getCreditBalances(user.id)).total).toBe(0)
  })

  it('charges a double tap once', async () => {
    const { user, preview } = await setup('doubletap')
    const clientRequestId = randomUUID()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => startRender(preview({ clientRequestId }))),
    )
    expect(new Set(results.map((r) => r.renderId)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect((await getCreditBalances(user.id)).total).toBe(2)
  })

  it("refuses someone else's room and a deleted room", async () => {
    const { preview } = await setup('room-owner')
    const other = await setup('room-other')
    expect(await outcome(() => startRender(preview({ roomId: other.room.id })))).toBe('not_found')

    const gone = await insertRoom(other.user.id, { deleted_at: new Date().toISOString() })
    expect(await outcome(() => startRender(other.preview({ roomId: gone.id })))).toBe('not_found')
  })
})

describe('failing a render', () => {
  it('refunds exactly once, however many times failure is reported', async () => {
    const { user, preview } = await setup('refund')
    const { renderId } = await startRender(preview())

    const results = await Promise.all(
      Array.from({ length: 10 }, () => failRender(renderId, 'provider_error', 'boom')),
    )
    expect(results.filter((r) => r.changed)).toHaveLength(1)
    expect(results.reduce((sum, r) => sum + r.refunded, 0)).toBe(1)

    expect((await getCreditBalances(user.id)).total).toBe(3)
    expect(await renderRow(renderId)).toMatchObject({
      status: 'failed',
      error_code: 'provider_error',
    })
    expect((await ledger(user.id)).filter((r) => r.kind === 'render_refund')).toEqual([
      { amount: 1, bucket: 'free', kind: 'render_refund', render_id: renderId },
    ])
  })

  it('does not refund a render that already succeeded', async () => {
    const { user, preview } = await setup('no-refund')
    const { renderId } = await startRender(preview())
    expect(
      await completeRender({
        renderId,
        resultPath: 'x/y.jpg',
        watermarkedPath: null,
        width: 10,
        height: 10,
      }),
    ).toBe(true)

    expect(await failRender(renderId, 'late_error')).toMatchObject({ changed: false, refunded: 0 })
    expect((await getCreditBalances(user.id)).total).toBe(2)
    expect((await renderRow(renderId)).status).toBe('succeeded')
  })

  it('drops a result that arrives after the render was failed and refunded', async () => {
    const { user, preview } = await setup('late')
    const { renderId } = await startRender(preview())
    await failRender(renderId, 'timeout')

    expect(
      await completeRender({
        renderId,
        resultPath: 'x/late.jpg',
        watermarkedPath: null,
        width: 10,
        height: 10,
      }),
    ).toBe(false)
    expect(await renderRow(renderId)).toMatchObject({ status: 'failed', result_path: null })
    expect((await getCreditBalances(user.id)).total).toBe(3)
  })

  it('sweeps renders past their deadline, once, and leaves the rest', async () => {
    const { user, preview } = await setup('sweep')
    const stale = await startRender(preview())
    const fresh = await startRender(preview())
    await sql(`update public.renders set deadline_at = now() - interval '1 second' where id = $1`, [
      stale.renderId,
    ])

    const sweeps = await Promise.all([failStaleRenders(), failStaleRenders(), failStaleRenders()])
    const swept = sweeps.flat().filter((id) => id === stale.renderId)
    expect(swept).toHaveLength(1)
    expect(sweeps.flat()).not.toContain(fresh.renderId)

    expect(await renderRow(stale.renderId)).toMatchObject({
      status: 'failed',
      error_code: 'timeout',
    })
    expect((await renderRow(fresh.renderId)).status).toBe('queued')
    expect((await getCreditBalances(user.id)).total).toBe(2)
  })
})

describe('buckets', () => {
  it('spends subscription credits first, then free, then pack, and refunds to where they came from', async () => {
    const { user, preview } = await setup('buckets')
    await getCreditBalances(user.id) // 3 free
    await grantCredits({
      userId: user.id,
      amount: 1,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `t:${randomUUID()}`,
    })
    await grantCredits({
      userId: user.id,
      amount: 5,
      kind: 'pack_purchase',
      bucket: 'pack',
      idempotencyKey: `t:${randomUUID()}`,
    })

    // A 2-credit spend would cross buckets; renders cost 1, so check the order step by step.
    const first = await startRender(preview())
    expect(await getCreditBalances(user.id)).toEqual({
      total: 8,
      subscription: 0,
      free: 3,
      pack: 5,
    })
    for (let i = 0; i < 3; i++) await startRender(preview())
    expect(await getCreditBalances(user.id)).toEqual({
      total: 5,
      subscription: 0,
      free: 0,
      pack: 5,
    })
    const packSpend = await startRender(preview())
    expect(await getCreditBalances(user.id)).toEqual({
      total: 4,
      subscription: 0,
      free: 0,
      pack: 4,
    })

    await failRender(first.renderId, 'x')
    await failRender(packSpend.renderId, 'x')
    expect(await getCreditBalances(user.id)).toEqual({
      total: 6,
      subscription: 1,
      free: 0,
      pack: 5,
    })
  })

  it('does not roll subscription credits over to the next grant', async () => {
    const { user, preview } = await setup('rollover')
    const key = randomUUID()
    await grantCredits({
      userId: user.id,
      amount: 50,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${key}:1`,
    })
    await startRender(preview())
    expect((await getCreditBalances(user.id)).subscription).toBe(49)

    await grantCredits({
      userId: user.id,
      amount: 50,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${key}:2`,
      resetBucket: true,
    })
    expect(await getCreditBalances(user.id)).toEqual({
      total: 53,
      subscription: 50,
      free: 3,
      pack: 0,
    })
    expect((await ledger(user.id)).find((r) => r.kind === 'expiry')).toMatchObject({
      amount: -49,
      bucket: 'subscription',
    })
  })

  it('writes off subscription credits when a subscription ends, once', async () => {
    const { user } = await setup('cancel')
    await grantCredits({
      userId: user.id,
      amount: 50,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${randomUUID()}`,
    })
    const key = `sub-end:${randomUUID()}`
    expect(
      await expireCredits({ userId: user.id, bucket: 'subscription', idempotencyKey: key }),
    ).toBe(50)
    expect(
      await expireCredits({ userId: user.id, bucket: 'subscription', idempotencyKey: key }),
    ).toBe(0)
    expect(await getCreditBalances(user.id)).toEqual({
      total: 3,
      subscription: 0,
      free: 3,
      pack: 0,
    })
  })
})

describe('grants', () => {
  it('treats a replayed grant as a no-op and a conflicting one as an error', async () => {
    const { user } = await setup('replay')
    const key = `cs:${randomUUID()}`
    const pack = {
      userId: user.id,
      amount: 20,
      kind: 'pack_purchase' as const,
      bucket: 'pack' as const,
      idempotencyKey: key,
    }

    const replays = await Promise.all(Array.from({ length: 5 }, () => grantCredits(pack)))
    expect(replays.filter(Boolean)).toHaveLength(1)
    expect((await getCreditBalances(user.id)).pack).toBe(20)

    expect(await outcome(() => grantCredits({ ...pack, amount: 60 }))).toBe('conflict')
    expect((await getCreditBalances(user.id)).pack).toBe(20)
  })

  it('rejects zero or negative grants', async () => {
    const { user } = await setup('badgrant')
    for (const amount of [0, -5]) {
      expect(
        await outcome(() =>
          grantCredits({
            userId: user.id,
            amount,
            kind: 'adjustment',
            bucket: 'free',
            idempotencyKey: `t:${randomUUID()}`,
          }),
        ),
      ).toBe('invalid_argument')
    }
  })
})

describe('HD finals', () => {
  it('needs a finished preview of the same room, by the same user', async () => {
    const { user, room, preview } = await setup('hd')
    const hd = (sourceRenderId?: string) => preview({ tier: 'hd', sourceRenderId })

    expect(await outcome(() => startRender(hd()))).toBe('invalid_argument')

    const pending = await startRender(preview())
    expect(await outcome(() => startRender(hd(pending.renderId)))).toBe('conflict')

    const other = await setup('hd-other')
    const foreign = await insertRender(other.user.id, other.room.id, {
      status: 'succeeded',
      result_path: 'x.jpg',
    })
    expect(await outcome(() => startRender(hd(foreign.id)))).toBe('not_found')

    const done = await insertRender(user.id, room.id, { status: 'succeeded', result_path: 'p.jpg' })
    const balanceBefore = (await getCreditBalances(user.id)).total
    const results = await Promise.all([
      startRender(hd(done.id)),
      startRender(hd(done.id)),
      startRender(hd(done.id)),
    ])
    expect(new Set(results.map((r) => r.renderId)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect((await getCreditBalances(user.id)).total).toBe(balanceBefore - CREDITS.cost.hd)
    expect(await renderRow(results[0].renderId)).toMatchObject({
      tier: 'hd',
      source_render_id: done.id,
    })
  })

  it('lets a user retry an HD final after the first attempt failed', async () => {
    const { user, room, preview } = await setup('hd-retry')
    const done = await insertRender(user.id, room.id, { status: 'succeeded', result_path: 'p.jpg' })
    const first = await startRender(preview({ tier: 'hd', sourceRenderId: done.id }))
    await failRender(first.renderId, 'provider_error')
    const second = await startRender(preview({ tier: 'hd', sourceRenderId: done.id }))
    expect(second.created).toBe(true)
    expect(second.renderId).not.toBe(first.renderId)
  })
})

describe('the ledger itself', () => {
  it('cannot be written directly, even by the service role', async () => {
    const { user } = await setup('direct')
    await getCreditBalances(user.id)
    const admin = serviceClient()

    const insert = await admin.from('credit_ledger').insert({
      user_id: user.id,
      amount: 1000,
      bucket: 'pack',
      kind: 'adjustment',
      idempotency_key: `hack:${randomUUID()}`,
    })
    expect(insert.error?.code).toBe('42501')
    expect(
      (await admin.from('credit_ledger').update({ amount: 1000 }).eq('user_id', user.id)).error
        ?.code,
    ).toBe('42501')
    expect((await admin.from('credit_ledger').delete().eq('user_id', user.id)).error?.code).toBe(
      '42501',
    )
    expect((await getCreditBalances(user.id)).total).toBe(3)
  })

  it('refuses updates even from the table owner', async () => {
    const { user } = await setup('owner-update')
    await getCreditBalances(user.id)
    await expect(
      sql('update public.credit_ledger set amount = 999 where user_id = $1', [user.id]),
    ).rejects.toThrow(/append_only/)
  })

  it('is invisible to browsers, and its functions cannot be called by them', async () => {
    const { user } = await setup('hidden')
    await getCreditBalances(user.id)
    for (const client of [user.client, anonClient()]) {
      const read = await client.from('credit_ledger').select('amount')
      expect(read.data ?? []).toEqual([])
      expect(read.error?.code).toBe('42501')

      const grant = await client.rpc('grant_credits', {
        p_user_id: user.id,
        p_amount: 1000,
        p_kind: 'adjustment',
        p_bucket: 'pack',
        p_idempotency_key: `hack:${randomUUID()}`,
      })
      expect(grant.error?.code).toBe('42501')
    }
    expect((await getCreditBalances(user.id)).total).toBe(3)
  })
})

describe('refunds across a plan renewal (review finding)', () => {
  async function planUserWithPendingRender(label: string, planCredits: number) {
    const ctx = await setup(label)
    await getCreditBalances(ctx.user.id) // 3 free
    await grantCredits({
      userId: ctx.user.id,
      amount: planCredits,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${randomUUID()}`,
    })
    const pending = await startRender(ctx.preview()) // paid from the plan bucket
    return { ...ctx, pending }
  }

  it('does not bring back a plan credit when the bucket was emptied at renewal', async () => {
    const { user, pending } = await planUserWithPendingRender('renew-empty', 1)
    await grantCredits({
      userId: user.id,
      amount: 50,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${randomUUID()}`,
      resetBucket: true,
    })
    const result = await failRender(pending.renderId, 'provider_error')
    expect(result).toMatchObject({ changed: true, refunded: 0 })
    expect(await getCreditBalances(user.id)).toMatchObject({ subscription: 50, free: 3 })
  })

  it('does not bring back a plan credit when leftovers were written off at renewal', async () => {
    const { user, pending } = await planUserWithPendingRender('renew-left', 5)
    await grantCredits({
      userId: user.id,
      amount: 50,
      kind: 'subscription_grant',
      bucket: 'subscription',
      idempotencyKey: `inv:${randomUUID()}`,
      resetBucket: true,
    })
    await failRender(pending.renderId, 'provider_error')
    expect((await getCreditBalances(user.id)).subscription).toBe(50)
  })

  it('does not bring back a plan credit after the plan ended', async () => {
    const { user, pending } = await planUserWithPendingRender('plan-end', 5)
    await expireCredits({
      userId: user.id,
      bucket: 'subscription',
      idempotencyKey: `end:${randomUUID()}`,
    })
    await failRender(pending.renderId, 'provider_error')
    expect((await getCreditBalances(user.id)).subscription).toBe(0)
  })

  it('still refunds a plan credit within the same period', async () => {
    const { user, pending } = await planUserWithPendingRender('same-period', 5)
    expect(await failRender(pending.renderId, 'provider_error')).toMatchObject({ refunded: 1 })
    expect((await getCreditBalances(user.id)).subscription).toBe(5)
  })
})

describe('claiming a submission (review finding)', () => {
  const claim = (renderId: string, replacing: string | null, staleSeconds = 60) =>
    serviceClient().rpc('claim_render_submission', {
      p_render_id: renderId,
      p_expected_request_id: replacing as string,
      p_stale_seconds: staleSeconds,
      p_max_attempts: 2,
    })

  it('lets exactly one caller submit a new render, and takes over only from a dead claim', async () => {
    const { preview } = await setup('claim-new')
    const { renderId } = await startRender(preview())
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(renderId, null)))
    expect(results.filter((r) => r.data === true)).toHaveLength(1)

    // A live claim blocks others; one older than the stale limit can be taken over.
    expect((await claim(renderId, null)).data).toBe(false)
    await sql(
      `update public.renders set last_checked_at = now() - interval '2 minutes' where id = $1`,
      [renderId],
    )
    expect((await claim(renderId, null)).data).toBe(true)
  })

  it('lets exactly one caller replace a failed provider job, within the attempt limit', async () => {
    const { preview } = await setup('claim-retry')
    const { renderId } = await startRender(preview())
    await serviceClient().rpc('mark_render_submitted', {
      p_render_id: renderId,
      p_provider_request_id: 'job-1',
      p_provider_endpoint: 'mock',
    })
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(renderId, 'job-1')))
    expect(results.filter((r) => r.data === true)).toHaveLength(1)

    await serviceClient().rpc('mark_render_submitted', {
      p_render_id: renderId,
      p_provider_request_id: 'job-2',
      p_provider_endpoint: 'mock',
    })
    // Two submissions used: no third.
    expect((await claim(renderId, 'job-2')).data).toBe(false)
  })

  it('never claims a finished render', async () => {
    const { preview } = await setup('claim-done')
    const { renderId } = await startRender(preview())
    await failRender(renderId, 'x')
    expect((await claim(renderId, null)).data).toBe(false)
  })
})
