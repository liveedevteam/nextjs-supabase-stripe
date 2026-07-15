import { describe, it, expect, vi } from 'vitest'
import { onInvoicePaid, onPaymentFailed, onTrialWillEnd } from '../webhooks/events/invoice.js'
import { mockSupabase } from './helpers.js'
import type Stripe from 'stripe'

const SUB_ID = 'sub_123'
const PRICE_ID = 'price_abc'
const PERIOD_START = 1700000000
const PERIOD_END = 1702678400

// Invoice with subscription ID in the new dahlia location
const invoice = (overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice =>
  ({
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    parent: {
      subscription_details: { subscription: SUB_ID },
    },
    ...overrides,
  } as unknown as Stripe.Invoice)

// invoice.paid/payment_failed are thin wrappers around
// syncSubscriptionFromStripe — the invoice's own period_start/period_end are
// no longer written anywhere; what gets written is whatever the fresh
// stripe.subscriptions.retrieve() call returns.
const subscription = (overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription =>
  ({
    id: SUB_ID,
    customer: 'cus_abc',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: PRICE_ID },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription)

const customerTableConfig = {
  stripe_customers: { single: { data: { user_id: 'user-123' }, error: null } },
}

const mockStripeReturning = (sub: Stripe.Subscription) =>
  ({ subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) } } as unknown as Stripe)

describe('onInvoicePaid', () => {
  it('fetches the subscription fresh from Stripe and upserts the returned status', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ status: 'active' }))
    await onInvoicePaid(invoice(), supabase, stripe)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.status).toBe('active')
    expect(upsertData.current_period_start).toBe(new Date(PERIOD_START * 1000).toISOString())
    expect(upsertData.current_period_end).toBe(new Date(PERIOD_END * 1000).toISOString())
  })

  it('cannot reactivate a subscription Stripe has since canceled — a delayed invoice.paid writes the fetched (canceled) status, not "active"', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ status: 'canceled' }))
    await onInvoicePaid(invoice(), supabase, stripe)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.status).toBe('canceled')
  })

  it('extracts subscription ID from an expanded Subscription object', async () => {
    const { supabase } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription())
    const expandedInvoice = invoice({
      parent: { subscription_details: { subscription: { id: SUB_ID } as any } } as any,
    })
    await onInvoicePaid(expandedInvoice, supabase, stripe)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID)
  })

  it('returns early without touching Stripe or the DB when invoice has no subscription parent (dahlia regression)', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription())
    await onInvoicePaid(invoice({ parent: null }), supabase, stripe)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(spies('subscriptions').upsertFn).not.toHaveBeenCalled()
  })

  it('throws when DB upsert fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ ...customerTableConfig, subscriptions: { upsert: { error: err } } })
    const stripe = mockStripeReturning(subscription())
    await expect(onInvoicePaid(invoice(), supabase, stripe)).rejects.toThrow('db error')
  })
})

describe('onPaymentFailed', () => {
  it('fetches fresh from Stripe and upserts whatever status Stripe put the subscription in (past_due, unpaid, or canceled depending on dunning settings)', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ status: 'past_due' }))
    await onPaymentFailed(invoice(), supabase, stripe)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.status).toBe('past_due')
  })

  it('returns early when invoice has no subscription', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription())
    await onPaymentFailed(invoice({ parent: null }), supabase, stripe)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(spies('subscriptions').upsertFn).not.toHaveBeenCalled()
  })
})

describe('onTrialWillEnd', () => {
  it('is a no-op and does not touch the database', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onTrialWillEnd({} as Stripe.Subscription, supabase)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
