import { describe, it, expect } from 'vitest'
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

describe('onSubscriptionUpdated', () => {
  it('upserts all fields — reads period dates from item, not from subscription (dahlia regression)', async () => {
    const { supabase, spies } = mockSupabase({
      ...customerTableConfig,
      subscriptions: {},
    })
    await onSubscriptionUpdated(subscription(), supabase)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.stripe_subscription_id).toBe(SUB_ID)
    expect(upsertData.stripe_price_id).toBe(PRICE_ID)
    expect(upsertData.status).toBe('active')
    expect(upsertData.current_period_start).toBe(new Date(PERIOD_START * 1000).toISOString())
    expect(upsertData.current_period_end).toBe(new Date(PERIOD_END * 1000).toISOString())
    expect(upsertData.cancel_at_period_end).toBe(false)
    expect(upsertData.cancel_at).toBeNull()
  })

  it('writes cancel_at as ISO string when set', async () => {
    const { supabase, spies } = mockSupabase({
      ...customerTableConfig,
      subscriptions: {},
    })
    await onSubscriptionUpdated(subscription({ cancel_at: CANCEL_AT }), supabase)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.cancel_at).toBe(new Date(CANCEL_AT * 1000).toISOString())
  })

  it('writes cancel_at as null — not NaN — when cancel_at is null', async () => {
    const { supabase, spies } = mockSupabase({
      ...customerTableConfig,
      subscriptions: {},
    })
    await onSubscriptionUpdated(subscription({ cancel_at: null }), supabase)
    const [upsertData] = spies('subscriptions').upsertFn.mock.calls[0]
    expect(upsertData.cancel_at).toBeNull()
  })

  it('throws with subscription ID when items array is empty', async () => {
    const { supabase } = mockSupabase(customerTableConfig)
    await expect(
      onSubscriptionUpdated(subscription({ items: { data: [] } as any }), supabase)
    ).rejects.toThrow(SUB_ID)
  })

  it('throws with customer ID when customer has no matching user', async () => {
    const { supabase } = mockSupabase({
      stripe_customers: { single: { data: null, error: null } },
    })
    await expect(onSubscriptionUpdated(subscription(), supabase)).rejects.toThrow(CUSTOMER_ID)
  })

  it('throws when DB upsert fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({
      ...customerTableConfig,
      subscriptions: { upsert: { error: err } },
    })
    await expect(onSubscriptionUpdated(subscription(), supabase)).rejects.toThrow('db error')
  })
})

describe('onSubscriptionDeleted', () => {
  it('updates status to canceled for the correct subscription ID', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onSubscriptionDeleted(subscription(), supabase)
    expect(spies('subscriptions').updateFn).toHaveBeenCalledWith({ status: 'canceled' })
    expect(spies('subscriptions').updateEqFn).toHaveBeenCalledWith('stripe_subscription_id', SUB_ID)
  })

  it('throws when DB update fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ subscriptions: { update: { error: err } } })
    await expect(onSubscriptionDeleted(subscription(), supabase)).rejects.toThrow('db error')
  })
})
