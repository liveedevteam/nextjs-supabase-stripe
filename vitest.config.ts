import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // tests/integration/local-supabase-guard.test.ts is pure logic (no live
    // Supabase) and runs here, alongside the rest of the fast unit suite —
    // not in vitest.integration.config.ts, which requires a running stack.
    include: ['src/**/*.test.ts', 'tests/integration/local-supabase-guard.test.ts'],
  },
})
