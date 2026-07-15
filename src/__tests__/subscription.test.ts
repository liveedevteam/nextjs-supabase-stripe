import { describe, it, expect, vi } from 'vitest'
import { onSubscriptionDeleted, onSubscriptionUpdated } from '../webhooks/events/subscription.js'
import { mockSupabase } from './helpers.js'
import type Stripe from 'stripe'

const CUSTOMER_ID = 'cus_abc'
const SUB_ID = 'sub_123'
const PRICE_ID = 'price_abc'

// Unix timestamps → the expected ISO strings
const PERIOD_START = 1700000000
const PERIOD_END = 1702678400
const CANCEL_AT = 1705356800

const item = (overrides = {}): Stripe.SubscriptionItem =>
  ({
    id: 'si_1',
    price: { id: PRICE_ID },
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
    ...overrides,
  } as unknown as Stripe.SubscriptionItem)

const subscription = (overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription =>
  ({
    id: SUB_ID,
    customer: CUSTOMER_ID,
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [item()] },
    ...overrides,
  } as unknown as Stripe.Subscription)

const customerTableConfig = {
  stripe_customers: { single: { data: { user_id: 'user-123' }, error: null } },
}

// Both handlers are thin wrappers around syncSubscriptionFromStripe, which
// always retrieves the subscription fresh from Stripe rather than trusting
// the event payload — the webhook event object here only carries the ID that
// gets fetched. mockStripe.subscriptions.retrieve is what actually supplies
// the "current truth" being tested.
const mockStripeReturning = (sub: Stripe.Subscription) =>
  ({ subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) } } as unknown as Stripe)

describe('onSubscriptionUpdated', () => {
  it('fetches the subscription fresh from Stripe by ID before writing anything', async () => {
    const { supabase } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription())
    await onSubscriptionUpdated(subscription(), supabase, stripe)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID)
  })

  it('upserts all fields from the fetched subscription — reads period dates from item, not from subscription (dahlia regression)', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription())
    await onSubscriptionUpdated(subscription(), supabase, stripe)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.stripe_subscription_id).toBe(SUB_ID)
    expect(upsertData.stripe_price_id).toBe(PRICE_ID)
    expect(upsertData.status).toBe('active')
    expect(upsertData.current_period_start).toBe(new Date(PERIOD_START * 1000).toISOString())
    expect(upsertData.current_period_end).toBe(new Date(PERIOD_END * 1000).toISOString())
    expect(upsertData.cancel_at_period_end).toBe(false)
    expect(upsertData.cancel_at).toBeNull()
  })

  it('writes the fetched status, not the event payload\'s status — this is what makes out-of-order delivery harmless', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    // Event says 'active' (maybe stale-by-delivery-time); Stripe's live state says 'canceled'.
    const stripe = mockStripeReturning(subscription({ status: 'canceled' }))
    await onSubscriptionUpdated(subscription({ status: 'active' }), supabase, stripe)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.status).toBe('canceled')
  })

  it('writes cancel_at as ISO string when set', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ cancel_at: CANCEL_AT }))
    await onSubscriptionUpdated(subscription(), supabase, stripe)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.cancel_at).toBe(new Date(CANCEL_AT * 1000).toISOString())
  })

  it('writes cancel_at as null — not NaN — when cancel_at is null', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ cancel_at: null }))
    await onSubscriptionUpdated(subscription(), supabase, stripe)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.cancel_at).toBeNull()
  })

  it('normalizes an expanded customer object to its ID', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const expandedSub = subscription({ customer: { id: CUSTOMER_ID } as unknown as Stripe.Customer })
    const stripe = mockStripeReturning(expandedSub)
    await onSubscriptionUpdated(subscription(), supabase, stripe)
    expect(supabase.from).toHaveBeenCalledWith('stripe_customers')
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.user_id).toBe('user-123')
  })

  it('throws with subscription ID when the fetched subscription has no items', async () => {
    const { supabase } = mockSupabase(customerTableConfig)
    const stripe = mockStripeReturning(subscription({ items: { data: [] } as any }))
    await expect(onSubscriptionUpdated(subscription(), supabase, stripe)).rejects.toThrow(SUB_ID)
  })

  it('throws when the fetched subscription item has no price id', async () => {
    const { supabase } = mockSupabase(customerTableConfig)
    const stripe = mockStripeReturning(subscription({ items: { data: [item({ price: null })] } as any }))
    await expect(onSubscriptionUpdated(subscription(), supabase, stripe)).rejects.toThrow(SUB_ID)
  })

  it('throws with customer ID when customer has no matching user', async () => {
    const { supabase } = mockSupabase({ stripe_customers: { single: { data: null, error: null } } })
    const stripe = mockStripeReturning(subscription())
    await expect(onSubscriptionUpdated(subscription(), supabase, stripe)).rejects.toThrow(CUSTOMER_ID)
  })

  it('throws when DB upsert fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ ...customerTableConfig, subscriptions: { upsert: { error: err } } })
    const stripe = mockStripeReturning(subscription())
    await expect(onSubscriptionUpdated(subscription(), supabase, stripe)).rejects.toThrow('db error')
  })
})

describe('onSubscriptionDeleted', () => {
  it('fetches fresh from Stripe and upserts the returned (canceled) status — subscriptions are never hard-deleted in Stripe', async () => {
    const { supabase, spies } = mockSupabase({ ...customerTableConfig, subscriptions: {} })
    const stripe = mockStripeReturning(subscription({ status: 'canceled' }))
    await onSubscriptionDeleted(subscription(), supabase, stripe)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(SUB_ID)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.status).toBe('canceled')
  })

  it('throws when DB upsert fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ ...customerTableConfig, subscriptions: { upsert: { error: err } } })
    const stripe = mockStripeReturning(subscription({ status: 'canceled' }))
    await expect(onSubscriptionDeleted(subscription(), supabase, stripe)).rejects.toThrow('db error')
  })
})
