import { loadEnvConfig } from '@next/env'
import { defineConfig, devices } from '@playwright/test'

loadEnvConfig(process.cwd())

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/**
 * End-to-end tests. They need the local Supabase stack (`npx supabase start`)
 * because sign-in emails are read from its test mailbox.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Mobile first: the phone layout is the product.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
