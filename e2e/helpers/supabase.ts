import { createClient } from '@supabase/supabase-js'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Is .env.local in place and Supabase running?`)
  return value
}

/** Service-role client for test setup and assertions. Never used by the app under test. */
export function adminClient() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** A unique address per call, so tests never share a user or a mailbox. */
export function uniqueEmail(prefix = 'user'): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `${prefix}-${id}@example.test`
}
