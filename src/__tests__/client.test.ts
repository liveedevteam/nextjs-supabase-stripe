import { describe, it, expect, beforeEach, vi } from 'vitest'

// client.ts memoizes its clients in module-level singletons, so each test
// needs a fresh module instance (vi.resetModules) to exercise the
// lazy-validation path rather than reusing a previously constructed client.
// That reset also means errors.js must be re-imported per test — a
// statically-imported class reference would be a different module instance
// than the one client.js sees after reset, breaking instanceof checks.
vi.mock('stripe', () => ({ default: class MockStripe {} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn().mockReturnValue({}) }))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV }
})

describe('getStripeClient', () => {
  it('throws MissingEnvironmentVariableError when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const { getStripeClient } = await import('../client.js')
    const { MissingEnvironmentVariableError } = await import('../errors.js')
    try {
      getStripeClient()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingEnvironmentVariableError)
      expect((e as Error).message).toContain('STRIPE_SECRET_KEY')
    }
  })

  it('constructs successfully when STRIPE_SECRET_KEY is set', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    const { getStripeClient } = await import('../client.js')
    expect(() => getStripeClient()).not.toThrow()
  })
})

describe('getServiceClient', () => {
  it('lists both variables in one error when both are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { getServiceClient } = await import('../client.js')
    const { MissingEnvironmentVariableError } = await import('../errors.js')
    try {
      getServiceClient()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingEnvironmentVariableError)
      expect((e as Error).message).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect((e as Error).message).toContain('SUPABASE_SERVICE_ROLE_KEY')
    }
  })

  it('lists only the missing variable when one is set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { getServiceClient } = await import('../client.js')
    try {
      getServiceClient()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('SUPABASE_SERVICE_ROLE_KEY')
      expect((e as Error).message).not.toContain('NEXT_PUBLIC_SUPABASE_URL')
    }
  })

  it('constructs successfully when both variables are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const { getServiceClient } = await import('../client.js')
    expect(() => getServiceClient()).not.toThrow()
  })
})
