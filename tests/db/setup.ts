import { existsSync, readFileSync } from 'node:fs'

/**
 * Load .env.local (then .env) so the database tests reach the local Supabase stack.
 *
 * Next's own loader (@next/env) deliberately skips .env.local when NODE_ENV is
 * "test", which Vitest sets, so the file is read here instead. Values already
 * in the environment win, so CI can override anything.
 */
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    const value = raw.replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}
