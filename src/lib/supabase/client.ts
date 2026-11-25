import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

/**
 * Supabase client for Client Components. Uses the publishable key, so every
 * query is subject to row level security as the signed-in user.
 */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey)
}
