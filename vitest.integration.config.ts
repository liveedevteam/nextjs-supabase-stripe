import { defineConfig } from 'vitest/config'

// Run with: pnpm test:integration
// Requires local Supabase (supabase start) with schema applied (supabase db reset --db-url <url> < tests/integration/schema.sql)
// Set in environment before running:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
//   SUPABASE_SERVICE_ROLE_KEY=<from supabase start output>

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // Placeholder key satisfies the Stripe SDK constructor (no API calls are made in handler tests)
      STRIPE_SECRET_KEY: 'sk_test_integration_placeholder',
      // Must match WEBHOOK_SECRET in setup.ts — used by the handler and by buildWebhookRequest
      STRIPE_WEBHOOK_SECRET: 'whsec_integration_test_secret',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    },
  },
})
