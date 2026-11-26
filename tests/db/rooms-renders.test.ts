import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anonClient,
  createUser,
  deleteCreatedUsers,
  insertRender,
  insertRoom,
  serviceClient,
  type TestUser,
} from '../helpers/db'

afterAll(deleteCreatedUsers)

const ROOM_VISIBLE = 'id, user_id, title, room_type, width, height, created_at'
const RENDER_VISIBLE =
  'id, user_id, room_id, source_render_id, tier, mode, params, status, error_code, ' +
  'result_width, result_height, credits_charged, is_saved, created_at, started_at, completed_at'

let owner: TestUser
let stranger: TestUser
let roomId: string
let renderId: string

beforeAll(async () => {
  owner = await createUser('owner')
  stranger = await createUser('stranger')
  roomId = (await insertRoom(owner.id)).id
  renderId = (await insertRender(owner.id, roomId)).id
})

describe('reading rooms and renders', () => {
  it('lets the owner read the client-visible columns', async () => {
    const rooms = await owner.client.from('rooms').select(ROOM_VISIBLE).eq('id', roomId)
    expect(rooms.error).toBeNull()
    expect(rooms.data).toHaveLength(1)

    const renders = await owner.client.from('renders').select(RENDER_VISIBLE).eq('id', renderId)
    expect(renders.error).toBeNull()
    expect(renders.data).toHaveLength(1)
  })

  it('hides them from another user and from anon', async () => {
    for (const client of [stranger.client, anonClient()]) {
      const rooms = await client.from('rooms').select('id').eq('id', roomId)
      expect(rooms.data ?? []).toEqual([])
      const renders = await client.from('renders').select('id').eq('id', renderId)
      expect(renders.data ?? []).toEqual([])
    }
    // They exist.
    expect((await serviceClient().from('rooms').select('id').eq('id', roomId)).data).toHaveLength(1)
  })

  it.each(['original_path', 'deleted_at', 'bytes', 'mime_type', '*'])(
    'refuses rooms.%s to the owner',
    async (column) => {
      const { error } = await owner.client.from('rooms').select(column).eq('id', roomId)
      expect(error?.code).toBe('42501')
    },
  )

  it.each([
    'prompt',
    'provider',
    'model',
    'provider_request_id',
    'cost_usd',
    'error_message',
    'result_path',
    'watermarked_path',
    'attempts',
    'deadline_at',
    '*',
  ])('refuses renders.%s to the owner', async (column) => {
    const { error } = await owner.client.from('renders').select(column).eq('id', renderId)
    expect(error?.code).toBe('42501')
  })

  it('hides a soft-deleted room from its owner', async () => {
    const gone = await insertRoom(owner.id, { deleted_at: new Date().toISOString() })
    const { data } = await owner.client.from('rooms').select('id').eq('id', gone.id)
    expect(data).toEqual([])
  })
})

describe('writing rooms and renders', () => {
  it('refuses client inserts', async () => {
    const room = await owner.client.from('rooms').insert({
      user_id: owner.id,
      original_path: `${owner.id}/x.jpg`,
      width: 1,
      height: 1,
      bytes: 1,
      mime_type: 'image/jpeg',
    })
    expect(room.error?.code).toBe('42501')

    const render = await owner.client.from('renders').insert({
      user_id: owner.id,
      room_id: roomId,
      tier: 'preview',
      mode: 'style',
      prompt: 'x',
      provider: 'mock',
      model: 'mock',
    })
    expect(render.error?.code).toBe('42501')
  })

  it('refuses client updates, including on the owner’s own rows', async () => {
    for (const change of [{ is_saved: true }, { status: 'succeeded' }, { credits_charged: 0 }]) {
      const { error } = await owner.client.from('renders').update(change).eq('id', renderId)
      expect(error?.code).toBe('42501')
    }
    const room = await owner.client.from('rooms').update({ title: 'x' }).eq('id', roomId)
    expect(room.error?.code).toBe('42501')

    const { data } = await serviceClient().from('renders').select('*').eq('id', renderId).single()
    expect(data).toMatchObject({ is_saved: false, status: 'queued' })
  })

  it('refuses client deletes', async () => {
    expect((await owner.client.from('renders').delete().eq('id', renderId)).error?.code).toBe(
      '42501',
    )
    expect((await owner.client.from('rooms').delete().eq('id', roomId)).error?.code).toBe('42501')
    expect((await serviceClient().from('rooms').select('id').eq('id', roomId)).data).toHaveLength(1)
  })
})

describe('render constraints', () => {
  async function expectRejected(overrides: Record<string, unknown>, code: string) {
    const { error } = await serviceClient()
      .from('renders')
      .insert({
        user_id: owner.id,
        room_id: roomId,
        tier: 'preview',
        mode: 'style',
        prompt: 'x',
        provider: 'mock',
        model: 'mock',
        ...overrides,
      })
    expect(error?.code, JSON.stringify(overrides)).toBe(code)
  }

  it('rejects an unknown status, tier or mode', async () => {
    await expectRejected({ status: 'done' }, '23514')
    await expectRejected({ tier: 'ultra' }, '23514')
    await expectRejected({ mode: 'magic' }, '23514')
  })

  it('requires a result path on a succeeded render', async () => {
    await expectRejected({ status: 'succeeded' }, '23514')
  })

  it('allows a source render only on an HD final', async () => {
    await expectRejected({ tier: 'preview', source_render_id: renderId }, '23514')
  })

  it('rejects params that are not a JSON object, and negative credits or cost', async () => {
    await expectRejected({ params: ['a'] }, '23514')
    await expectRejected({ credits_charged: -1 }, '23514')
    await expectRejected({ cost_usd: -0.01 }, '23514')
  })

  it('allows one render per provider request id', async () => {
    const requestId = randomUUID()
    await insertRender(owner.id, roomId, { provider_request_id: requestId })
    await expectRejected({ provider_request_id: requestId }, '23505')
  })

  it('moves updated_at on update', async () => {
    const admin = serviceClient()
    const before = (await admin.from('renders').select('updated_at').eq('id', renderId).single())
      .data!
    await new Promise((resolve) => setTimeout(resolve, 20))
    await admin.from('renders').update({ attempts: 1 }).eq('id', renderId)
    const after = (await admin.from('renders').select('updated_at').eq('id', renderId).single())
      .data!
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    )
  })

  it('deletes renders with their room, and keeps an HD final when its preview goes', async () => {
    const admin = serviceClient()
    const room = await insertRoom(owner.id)
    const preview = await insertRender(owner.id, room.id, {
      status: 'succeeded',
      result_path: 'x/preview.jpg',
    })
    const hd = await insertRender(owner.id, room.id, { tier: 'hd', source_render_id: preview.id })

    await admin.from('renders').delete().eq('id', preview.id)
    const kept = (await admin.from('renders').select('source_render_id').eq('id', hd.id).single())
      .data
    expect(kept).toEqual({ source_render_id: null })

    await admin.from('rooms').delete().eq('id', room.id)
    expect((await admin.from('renders').select('id').eq('room_id', room.id)).data).toEqual([])
  })
})
