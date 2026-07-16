import { describe, it, expect, vi } from 'vitest'
import Stripe from 'stripe'
import { backfillStripeCustomers } from '../scripts/backfill.js'

interface FakeUser {
  id: string
  email?: string
}

// Mimics the two Supabase surfaces backfill.ts touches: auth.admin.listUsers
// (paginated) and .from('stripe_customers'). Kept local rather than reusing
// helpers.ts's mockSupabase, which doesn't model auth.admin at all.
function makeSupabase(opts: {
  pages: FakeUser[][]
  alreadySynced?: Set<string>
  selectError?: { message: string }
  insertError?: { message: string }
}) {
  const inserted: { user_id: string; stripe_customer_id: string }[] = []
  const listUsers = vi.fn(async ({ page }: { page: number }) => ({
    data: { users: opts.pages[page - 1] ?? [] },
    error: null,
  }))

  const supabase = {
    auth: { admin: { listUsers } },
    from: vi.fn((table: string) => {
      if (table !== 'stripe_customers') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: async () => {
              if (opts.selectError) return { data: null, error: opts.selectError }
              if (opts.alreadySynced?.has(userId)) return { data: { user_id: userId }, error: null }
              return { data: null, error: null }
            },
          }),
        }),
        insert: async (row: { user_id: string; stripe_customer_id: string }) => {
          if (opts.insertError) return { error: opts.insertError }
          inserted.push(row)
          return { error: null }
        },
      }
    }),
  }

  return { supabase: supabase as any, listUsers, inserted }
}

// Mimics stripe.customers.list keyed by email. rateLimitedCallsRemaining
// makes the first N calls throw StripeRateLimitError before succeeding —
// listCustomersByEmail's retry loop should absorb this transparently.
function makeStripe(byEmail: Record<string, { id: string }[]>, opts: { rateLimitedCallsRemaining?: number } = {}) {
  let remaining = opts.rateLimitedCallsRemaining ?? 0
  const list = vi.fn(async ({ email }: { email: string }) => {
    if (remaining > 0) {
      remaining--
      throw new Stripe.errors.StripeRateLimitError({ message: 'rate limited' })
    }
    return { data: byEmail[email] ?? [] }
  })
  return { customers: { list } } as unknown as Stripe
}

const OPTS = { dryRun: false, throttleMs: 0 }

describe('backfillStripeCustomers', () => {
  it('matches a user with exactly one Stripe customer for their email', async () => {
    const { supabase, inserted } = makeSupabase({ pages: [[{ id: 'user-1', email: 'a@example.com' }]] })
    const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.matched).toEqual(['user-1'])
    expect(inserted).toEqual([{ user_id: 'user-1', stripe_customer_id: 'cus_1' }])
  })

  it('skips a user who already has a stripe_customers row — does not call Stripe for them', async () => {
    const { supabase } = makeSupabase({
      pages: [[{ id: 'user-1', email: 'a@example.com' }]],
      alreadySynced: new Set(['user-1']),
    })
    const stripe = makeStripe({})

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.alreadySynced).toEqual(['user-1'])
    expect(result.matched).toEqual([])
    expect(vi.mocked(stripe.customers.list)).not.toHaveBeenCalled()
  })

  it('skips a user with no email — never calls Stripe with an undefined filter', async () => {
    const { supabase } = makeSupabase({ pages: [[{ id: 'user-1' }]] })
    const stripe = makeStripe({})

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.noEmail).toEqual(['user-1'])
    expect(vi.mocked(stripe.customers.list)).not.toHaveBeenCalled()
  })

  it('records "no Stripe customer" for a user whose email matches nothing — does not insert', async () => {
    const { supabase, inserted } = makeSupabase({ pages: [[{ id: 'user-1', email: 'nobody@example.com' }]] })
    const stripe = makeStripe({})

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.noStripeCustomer).toEqual(['user-1'])
    expect(inserted).toEqual([])
  })

  it('flags an ambiguous match instead of guessing which customer to link — the original bug', async () => {
    const { supabase, inserted } = makeSupabase({ pages: [[{ id: 'user-1', email: 'shared@example.com' }]] })
    const stripe = makeStripe({ 'shared@example.com': [{ id: 'cus_a' }, { id: 'cus_b' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.ambiguous).toEqual([
      { userId: 'user-1', email: 'shared@example.com', stripeCustomerIds: ['cus_a', 'cus_b'] },
    ])
    expect(result.matched).toEqual([])
    expect(inserted).toEqual([])
  })

  it('paginates through multiple pages of users', async () => {
    // A page only stops pagination when it returns fewer than perPage (1000)
    // users, so page 1 must be a full 1000-user page to force a second
    // listUsers call — anything smaller would trivially pass without
    // actually exercising the pagination loop.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `user-${i}` }))
    const page2 = [{ id: 'user-1000', email: 'last@example.com' }]
    const { supabase, listUsers } = makeSupabase({ pages: [page1, page2] })
    const stripe = makeStripe({ 'last@example.com': [{ id: 'cus_last' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(listUsers).toHaveBeenCalledTimes(2)
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 })
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 })
    expect(result.totalUsers).toBe(1001)
    expect(result.matched).toEqual(['user-1000'])
  })

  it('retries through Stripe rate limiting and still matches the user', async () => {
    // The retry backoff is a real setTimeout((attempt+1) * 1000ms) — fake
    // timers avoid actually waiting several real seconds for this test.
    vi.useFakeTimers()
    try {
      const { supabase } = makeSupabase({ pages: [[{ id: 'user-1', email: 'a@example.com' }]] })
      const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }] }, { rateLimitedCallsRemaining: 2 })

      const resultPromise = backfillStripeCustomers({ supabase, stripe, ...OPTS })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.matched).toEqual(['user-1'])
      expect(vi.mocked(stripe.customers.list)).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records a failure — does not throw and abort the whole run — when the stripe_customers select fails', async () => {
    const { supabase } = makeSupabase({
      pages: [[{ id: 'user-1', email: 'a@example.com' }, { id: 'user-2', email: 'b@example.com' }]],
      selectError: { message: 'connection refused' },
    })
    const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }], 'b@example.com': [{ id: 'cus_2' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.failed).toHaveLength(2)
    expect(result.failed[0].error).toContain('connection refused')
    expect(result.matched).toEqual([])
  })

  it('records a failure when the stripe_customers insert fails, instead of reporting a false match', async () => {
    const { supabase } = makeSupabase({
      pages: [[{ id: 'user-1', email: 'a@example.com' }]],
      insertError: { message: 'duplicate key' },
    })
    const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.failed).toEqual([{ userId: 'user-1', error: 'stripe_customers insert failed: duplicate key' }])
    expect(result.matched).toEqual([])
  })

  it('records a failure when Stripe itself errors for a reason other than rate limiting', async () => {
    const { supabase } = makeSupabase({ pages: [[{ id: 'user-1', email: 'a@example.com' }]] })
    const stripe = { customers: { list: vi.fn().mockRejectedValue(new Error('Stripe is down')) } } as unknown as Stripe

    const result = await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(result.failed).toEqual([{ userId: 'user-1', error: 'Stripe customer lookup failed: Stripe is down' }])
  })

  it('dry-run mode matches and reports, but never inserts', async () => {
    const { supabase, inserted } = makeSupabase({ pages: [[{ id: 'user-1', email: 'a@example.com' }]] })
    const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }] })

    const result = await backfillStripeCustomers({ supabase, stripe, dryRun: true, throttleMs: 0 })

    expect(result.matched).toEqual(['user-1'])
    expect(inserted).toEqual([])
  })

  it('stops paginating once a page returns fewer users than perPage', async () => {
    const { supabase, listUsers } = makeSupabase({ pages: [[{ id: 'user-1', email: 'a@example.com' }]] })
    const stripe = makeStripe({ 'a@example.com': [{ id: 'cus_1' }] })

    await backfillStripeCustomers({ supabase, stripe, ...OPTS })

    expect(listUsers).toHaveBeenCalledTimes(1)
  })
})
