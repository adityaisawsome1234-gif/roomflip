import { loadEnvConfig } from '@next/env'

// Load .env.local the same way Next.js does, so tests use the local Supabase stack.
loadEnvConfig(process.cwd())
