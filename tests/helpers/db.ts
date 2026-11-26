import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Helpers for the database tests. Three kinds of access are exercised:
 *   - asUser():   a browser-like client signed in as one user (publishable key + session)
 *   - anonClient(): a browser-like client with no session
 *   - serviceClient(): the server's service-role client, which bypasses row level security
 * plus sql() for catalog queries straight against Postgres.
 */

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Is .env.local in place and Supabase running?`)
  return value
}

const url = () => env('NEXT_PUBLIC_SUPABASE_URL')
const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const

export type Client = SupabaseClient<Database>

export function serviceClient(): Client {
  return createClient<Database>(url(), env('SUPABASE_SECRET_KEY'), noSession)
}

export function anonClient(): Client {
  return createClient<Database>(url(), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), noSession)
}

export const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Run one query as the postgres superuser. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  try {
    return (await client.query<T>(text, values)).rows
  } finally {
    await client.end()
  }
}

export interface TestUser {
  id: string
  email: string
  /** A client signed in as this user, exactly like the browser would be. */
  client: Client
}

/** A unique address so test runs never collide. */
export function testEmail(label: string): string {
  return `dbtest-${label}-${Date.now().toString(36)}${randomUUID().slice(0, 6)}@example.test`
}

const created: string[] = []

/** Create a confirmed user and sign a fresh client in as them. */
export async function createUser(
  label: string,
  metadata: Record<string, unknown> = {},
): Promise<TestUser> {
  const email = testEmail(label)
  const password = `pw-${randomUUID()}`
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  created.push(data.user.id)

  const client = anonClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`)
  return { id: data.user.id, email, client }
}

/** Delete every user this test file created (cascades to their data). */
export async function deleteCreatedUsers(): Promise<void> {
  const admin = serviceClient()
  while (created.length > 0) {
    const id = created.pop()!
    await admin.auth.admin.deleteUser(id)
  }
}

/** Insert a room for a user with the service role. */
export async function insertRoom(userId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await serviceClient()
    .from('rooms')
    .insert({
      user_id: userId,
      original_path: `${userId}/${randomUUID()}.jpg`,
      width: 1200,
      height: 900,
      bytes: 123_456,
      mime_type: 'image/jpeg',
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`insertRoom failed: ${error?.message}`)
  return data
}

/** Insert a render for a room with the service role. */
export async function insertRender(
  userId: string,
  roomId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await serviceClient()
    .from('renders')
    .insert({
      user_id: userId,
      room_id: roomId,
      tier: 'preview',
      mode: 'style',
      params: { preset: 'japandi' },
      prompt: 'internal prompt text',
      provider: 'mock',
      model: 'mock',
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`insertRender failed: ${error?.message}`)
  return data
}
