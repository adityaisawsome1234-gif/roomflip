/**
 * Public environment values. These are inlined into the browser bundle at
 * build time, so each one must be read as a literal `process.env.NEXT_PUBLIC_*`.
 * Server-only secrets live in env.server.ts.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

export const publicEnv = {
  get supabaseUrl(): string {
    return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
  },
  get supabasePublishableKey(): string {
    return required(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
  },
  /** Canonical origin of the site, no trailing slash. */
  get siteUrl(): string {
    return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  },
  /** Show the "Continue with Google" button. Off until an OAuth client is configured. */
  get googleAuthEnabled(): boolean {
    return process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true'
  },
}
