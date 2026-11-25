import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { publicEnv } from '@/lib/env'
import { serverEnv } from '@/lib/env.server'
import type { Database } from './database.types'

/**
 * Service-role Supabase client. It bypasses row level security, so:
 *   - only import it from server code (this module is marked server-only);
 *   - always scope queries to a user id you have already verified;
 *   - never return its raw results to the browser without picking fields.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, serverEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
