import 'server-only'

/**
 * Server-only environment variables.
 *
 * SERVER_ENV_KEYS is the single list of every secret and server setting the
 * app reads. A test checks that .env.example documents each one, so adding a
 * key here without documenting it fails CI.
 *
 * Values are read lazily: a missing key only throws when the feature that
 * needs it runs, so the app still boots while later milestones are unconfigured.
 */
export const SERVER_ENV_KEYS = [
  // Supabase
  'SUPABASE_SECRET_KEY',
  // Image generation (fal.ai)
  'FAL_KEY',
  'RENDER_MODEL_PREVIEW',
  'RENDER_MODEL_HD',
  // Moderation (OpenAI)
  'OPENAI_API_KEY',
  // Stripe
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PRO_WEEKLY',
  'STRIPE_PRICE_PRO_ANNUAL',
  'STRIPE_PRICE_PACK_20',
  'STRIPE_PRICE_PACK_60',
  // Test only: point the Stripe client at stripe-mock (http://localhost:12111).
  'STRIPE_API_BASE',
  // Analytics (PostHog), server-side capture
  'POSTHOG_API_KEY',
  // Admin page allowlist: comma-separated emails
  'ADMIN_EMAILS',
  // Shared secret for scheduled job endpoints
  'CRON_SECRET',
] as const

export type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number]

/** Read a server env var, or undefined when it is not set. */
export function optionalServerEnv(key: ServerEnvKey): string | undefined {
  const value = process.env[key]
  return value && value.length > 0 ? value : undefined
}

/** Read a server env var, throwing a clear error when it is not set. */
export function serverEnv(key: ServerEnvKey): string {
  const value = optionalServerEnv(key)
  if (!value) {
    throw new Error(`Missing environment variable ${key}. See .env.example for what it is for.`)
  }
  return value
}
