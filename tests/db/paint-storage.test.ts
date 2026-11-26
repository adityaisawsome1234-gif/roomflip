import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anonClient,
  createUser,
  deleteCreatedUsers,
  serviceClient,
  type TestUser,
} from '../helpers/db'

const TEST_PREFIX = `TEST-${randomUUID().slice(0, 8)}`

afterAll(async () => {
  await serviceClient().from('paint_colors').delete().like('code', `${TEST_PREFIX}%`)
  await deleteCreatedUsers()
})

describe('paint_colors', () => {
  let user: TestUser
  const activeCode = `${TEST_PREFIX}-A`
  const inactiveCode = `${TEST_PREFIX}-I`

  beforeAll(async () => {
    user = await createUser('paint')
    const { error } = await serviceClient()
      .from('paint_colors')
      .insert([
        {
          brand: 'benjamin_moore',
          name: `${TEST_PREFIX} Active`,
          code: activeCode,
          hex: '#ABCDEF',
          family: 'blue',
          // Every row needs the same columns: PostgREST fills a missing one with null, not its default.
          is_active: true,
        },
        {
          brand: 'benjamin_moore',
          name: `${TEST_PREFIX} Hidden`,
          code: inactiveCode,
          hex: '#123456',
          family: 'gray',
          is_active: false,
        },
      ])
    if (error) throw error
  })

  it('shows active colors and hides inactive ones, signed in or not', async () => {
    for (const client of [anonClient(), user.client]) {
      const { data, error } = await client
        .from('paint_colors')
        .select('code')
        .like('code', `${TEST_PREFIX}%`)
      expect(error).toBeNull()
      expect(data).toEqual([{ code: activeCode }])
    }
  })

  it('refuses client writes', async () => {
    for (const client of [anonClient(), user.client]) {
      const insert = await client.from('paint_colors').insert({
        brand: 'benjamin_moore',
        name: 'x',
        code: `${TEST_PREFIX}-X`,
        hex: '#000000',
        family: 'black',
      })
      expect(insert.error?.code).toBe('42501')
      expect(
        (await client.from('paint_colors').update({ hex: '#000000' }).eq('code', activeCode)).error
          ?.code,
      ).toBe('42501')
      expect((await client.from('paint_colors').delete().eq('code', activeCode)).error?.code).toBe(
        '42501',
      )
    }
    const { data } = await serviceClient()
      .from('paint_colors')
      .select('hex')
      .eq('code', activeCode)
      .single()
    expect(data).toEqual({ hex: '#ABCDEF' })
  })

  it.each([
    ['lowercase hex', { hex: '#abcdef' }, '23514'],
    ['short hex', { hex: '#ABC' }, '23514'],
    ['unknown brand', { brand: 'acme' }, '23514'],
    ['unknown family', { family: 'teal' }, '23514'],
    ['duplicate brand and code', { code: activeCode }, '23505'],
  ])('rejects %s', async (_label, change, code) => {
    const { error } = await serviceClient()
      .from('paint_colors')
      .insert({
        brand: 'benjamin_moore',
        name: `${TEST_PREFIX} bad`,
        code: `${TEST_PREFIX}-${randomUUID().slice(0, 6)}`,
        hex: '#000000',
        family: 'black',
        ...change,
      })
    expect(error?.code).toBe(code)
  })
})

describe('storage', () => {
  const BUCKETS = ['originals', 'swatches', 'renders', 'exports'] as const
  let user: TestUser
  let path: string
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  )

  beforeAll(async () => {
    user = await createUser('storage')
    path = `${user.id}/${randomUUID()}.png`
    const { error } = await serviceClient()
      .storage.from('originals')
      .upload(path, pixel, { contentType: 'image/png' })
    if (error) throw error
  })

  afterAll(async () => {
    await serviceClient().storage.from('originals').remove([path])
  })

  it('has the four buckets, all private', async () => {
    const { data, error } = await serviceClient().storage.listBuckets()
    expect(error).toBeNull()
    for (const id of BUCKETS) {
      const bucket = data?.find((b) => b.id === id)
      expect(bucket, id).toBeDefined()
      expect(bucket!.public, id).toBe(false)
    }
  })

  it('gives clients no way in, even to an object under their own id', async () => {
    for (const [label, client] of [
      ['owner', user.client],
      ['anon', anonClient()],
    ] as const) {
      const bucket = client.storage.from('originals')

      const download = await bucket.download(path)
      expect(download.data, `${label} download`).toBeNull()

      const list = await bucket.list(user.id)
      expect(list.data ?? [], `${label} list`).toEqual([])

      const signed = await bucket.createSignedUrl(path, 60)
      expect(signed.data, `${label} sign`).toBeNull()

      const overwrite = await bucket.upload(path, pixel, { contentType: 'image/png', upsert: true })
      expect(overwrite.data, `${label} overwrite`).toBeNull()

      const fresh = await bucket.upload(`${user.id}/${randomUUID()}.png`, pixel, {
        contentType: 'image/png',
      })
      expect(fresh.data, `${label} upload`).toBeNull()

      // remove() reports success with an empty list when RLS hides the object.
      await bucket.remove([path])
    }

    // The object is still there and unchanged.
    const { data } = await serviceClient().storage.from('originals').download(path)
    expect(data).not.toBeNull()
    expect(Buffer.from(await data!.arrayBuffer())).toEqual(pixel)
  })

  it('lets the server hand out a signed URL that works', async () => {
    const { data, error } = await serviceClient()
      .storage.from('originals')
      .createSignedUrl(path, 60)
    expect(error).toBeNull()
    const response = await fetch(data!.signedUrl)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pixel)
  })
})
