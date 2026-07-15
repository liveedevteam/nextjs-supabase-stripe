import { defineConfig } from 'vitest/config'

// Run with: pnpm test:integration
// Requires local Supabase (supabase start) with schema applied (supabase db reset --db-url <url> < tests/integration/schema.sql)
// Set in environment before running:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
//   SUPABASE_SERVICE_ROLE_KEY=<from supabase start output>

export default defineConfig({
  test: {
    environment: 'node',
    // local-supabase-guard.test.ts is pure logic and runs in the fast unit
    // suite (vitest.config.ts) instead — excluded here to keep this suite's
    // count exactly the set of tests that require a live local Supabase stack.
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/integration/local-supabase-guard.test.ts'],
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
