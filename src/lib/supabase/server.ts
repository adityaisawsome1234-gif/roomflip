import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * It acts as the signed-in user (publishable key + session cookies), so row
 * level security applies.
 *
 * It reads cookies, so with Cache Components any Server Component that calls
 * it must render inside a <Suspense> boundary.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: src/proxy.ts refreshes the session on every request.
        }
      },
    },
  })
}
