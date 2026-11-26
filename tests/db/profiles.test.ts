import { afterAll, describe, expect, it } from 'vitest'
import {
  anonClient,
  createUser,
  deleteCreatedUsers,
  insertRender,
  insertRoom,
  serviceClient,
  testEmail,
} from '../helpers/db'

afterAll(deleteCreatedUsers)

async function profileOf(id: string) {
  const { data, error } = await serviceClient().from('profiles').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

describe('profile creation', () => {
  it('creates a profile with the id and email when a user signs up', async () => {
    const user = await createUser('basic')
    const profile = await profileOf(user.id)
    expect(profile.email).toBe(user.email)
    expect(profile.display_name).toBeNull()
  })

  it('cuts a long full_name to 80 characters', async () => {
    const user = await createUser('longname', { full_name: 'x'.repeat(120) })
    expect((await profileOf(user.id)).display_name).toBe('x'.repeat(80))
  })

  it('treats a whitespace-only name as no name', async () => {
    const user = await createUser('blank', { full_name: '   ' })
    expect((await profileOf(user.id)).display_name).toBeNull()
  })

  it('falls back to "name" when "full_name" is absent', async () => {
    const user = await createUser('altname', { name: 'Ada' })
    expect((await profileOf(user.id)).display_name).toBe('Ada')
  })

  it('keeps an https avatar and drops one that is not https or too long', async () => {
    const good = await createUser('avatar-ok', { avatar_url: 'https://cdn.example.test/a.png' })
    expect((await profileOf(good.id)).avatar_url).toBe('https://cdn.example.test/a.png')

    const plain = await createUser('avatar-http', { avatar_url: 'http://cdn.example.test/a.png' })
    expect((await profileOf(plain.id)).avatar_url).toBeNull()

    const script = await createUser('avatar-js', { avatar_url: 'javascript:alert(1)' })
    expect((await profileOf(script.id)).avatar_url).toBeNull()

    const long = await createUser('avatar-long', {
      avatar_url: `https://cdn.example.test/${'a'.repeat(2100)}`,
    })
    expect((await profileOf(long.id)).avatar_url).toBeNull()
  })

  it('follows a change of email address', async () => {
    const user = await createUser('emailchange')
    const next = testEmail('emailchange-new')
    const { error } = await serviceClient().auth.admin.updateUserById(user.id, {
      email: next,
      email_confirm: true,
    })
    expect(error).toBeNull()
    expect((await profileOf(user.id)).email).toBe(next)
  })
})

describe('profile access', () => {
  it('lets a user read their own profile and no one else', async () => {
    const alice = await createUser('read-a')
    const bob = await createUser('read-b')

    const own = await alice.client.from('profiles').select('id, email')
    expect(own.error).toBeNull()
    expect(own.data).toEqual([{ id: alice.id, email: alice.email }])

    const other = await alice.client.from('profiles').select('id').eq('id', bob.id)
    expect(other.data).toEqual([])
    // Bob's row is really there.
    expect((await profileOf(bob.id)).id).toBe(bob.id)
  })

  it('shows anon nothing', async () => {
    await createUser('anon-target')
    const { data, error } = await anonClient().from('profiles').select('id')
    // anon has no grant on profiles at all.
    expect(data ?? []).toEqual([])
    expect(error?.code).toBe('42501')
  })

  it('lets a user change their display name and moves updated_at', async () => {
    const user = await createUser('rename')
    const before = await profileOf(user.id)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const { error } = await user.client
      .from('profiles')
      .update({ display_name: 'New Name' })
      .eq('id', user.id)
    expect(error).toBeNull()

    const after = await profileOf(user.id)
    expect(after.display_name).toBe('New Name')
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    )
  })

  it.each([
    ['email', { email: 'hijack@example.test' }],
    ['avatar_url', { avatar_url: 'https://evil.example.test/x.png' }],
    ['created_at', { created_at: '2000-01-01T00:00:00Z' }],
  ])('refuses a change to %s', async (_column, change) => {
    const user = await createUser('locked-col')
    const before = await profileOf(user.id)
    const { error } = await user.client.from('profiles').update(change).eq('id', user.id)
    expect(error?.code).toBe('42501')
    expect(await profileOf(user.id)).toEqual(before)
  })

  it("cannot change someone else's display name", async () => {
    const alice = await createUser('other-a')
    const bob = await createUser('other-b')
    const { data } = await alice.client
      .from('profiles')
      .update({ display_name: 'pwned' })
      .eq('id', bob.id)
      .select('id')
    expect(data ?? []).toEqual([])
    expect((await profileOf(bob.id)).display_name).toBeNull()
  })

  it('cannot insert or delete profiles', async () => {
    const user = await createUser('insdel')
    const insert = await user.client
      .from('profiles')
      .insert({ id: crypto.randomUUID(), email: 'x@example.test' })
    expect(insert.error?.code).toBe('42501')

    const del = await user.client.from('profiles').delete().eq('id', user.id)
    expect(del.error?.code).toBe('42501')
    expect((await profileOf(user.id)).id).toBe(user.id)
  })
})

describe('account deletion', () => {
  it('removes the profile, rooms and renders with the auth user', async () => {
    const user = await createUser('cascade')
    const room = await insertRoom(user.id)
    await insertRender(user.id, room.id)

    const { error } = await serviceClient().auth.admin.deleteUser(user.id)
    expect(error).toBeNull()

    const admin = serviceClient()
    expect((await admin.from('profiles').select('id').eq('id', user.id)).data).toEqual([])
    expect((await admin.from('rooms').select('id').eq('user_id', user.id)).data).toEqual([])
    expect((await admin.from('renders').select('id').eq('user_id', user.id)).data).toEqual([])
  })
})
