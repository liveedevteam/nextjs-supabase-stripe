import { describe, it, expect } from 'vitest'
import { onCheckoutAsyncPaymentFailed, onCheckoutAsyncPaymentSucceeded, onCheckoutCompleted } from '../webhooks/events/checkout.js'
import { mockSupabase } from './helpers.js'
import type Stripe from 'stripe'

const session = (overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session =>
  ({
    id: 'cs_test_123',
    mode: 'payment',
    amount_total: 2000,
    currency: 'usd',
    payment_status: 'paid',
    customer: 'cus_abc',
    metadata: { user_id: 'user-123' },
    ...overrides,
  } as Stripe.Checkout.Session)

describe('onCheckoutCompleted', () => {
  describe('mode: payment', () => {
    it('inserts order with status: paid when payment_status is paid', async () => {
      const { supabase, spies } = mockSupabase({ orders: {} })
      await onCheckoutCompleted(session(), supabase)
      expect(spies('orders').insertFn).toHaveBeenCalledWith({
        user_id: 'user-123',
        stripe_session_id: 'cs_test_123',
        amount: 2000,
        currency: 'usd',
        status: 'paid',
      })
    })

    it('inserts order with status: pending when payment_status is unpaid — a delayed payment method (e.g. bank debit) hasn\'t cleared yet', async () => {
      const { supabase, spies } = mockSupabase({ orders: {} })
      await onCheckoutCompleted(session({ payment_status: 'unpaid' }), supabase)
      const [insertArg] = spies('orders').insertFn.mock.calls[0]
      expect(insertArg.status).toBe('pending')
    })

    it('inserts order with user_id: null for anonymous checkout', async () => {
      const { supabase, spies } = mockSupabase({ orders: {} })
      await onCheckoutCompleted(session({ metadata: {} }), supabase)
      const [insertArg] = spies('orders').insertFn.mock.calls[0]
      expect(insertArg.user_id).toBeNull()
    })

    it('throws instead of writing a null amount when amount_total is missing', async () => {
      const { supabase, spies } = mockSupabase({ orders: {} })
      await expect(
        onCheckoutCompleted(session({ amount_total: null }), supabase)
      ).rejects.toThrow('cs_test_123')
      expect(spies('orders').insertFn).not.toHaveBeenCalled()
    })

    it('throws instead of writing a missing currency', async () => {
      const { supabase, spies } = mockSupabase({ orders: {} })
      await expect(
        onCheckoutCompleted(session({ currency: undefined as unknown as string }), supabase)
      ).rejects.toThrow('cs_test_123')
      expect(spies('orders').insertFn).not.toHaveBeenCalled()
    })

    it('throws when DB insert fails', async () => {
      const err = new Error('db error')
      const { supabase } = mockSupabase({ orders: { insert: { error: err } } })
      await expect(onCheckoutCompleted(session(), supabase)).rejects.toThrow('db error')
    })
  })

  describe('mode: subscription', () => {
    it('upserts stripe_customers when user_id and customer are present', async () => {
      const { supabase, spies } = mockSupabase({ stripe_customers: {} })
      await onCheckoutCompleted(session({ mode: 'subscription' }), supabase)
      expect(spies('stripe_customers').upsertFn).toHaveBeenCalledWith(
        { user_id: 'user-123', stripe_customer_id: 'cus_abc' },
        { onConflict: 'user_id' }
      )
    })

    it('normalizes an expanded customer object to its ID', async () => {
      const { supabase, spies } = mockSupabase({ stripe_customers: {} })
      const expanded = session({ mode: 'subscription', customer: { id: 'cus_abc' } as unknown as Stripe.Customer })
      await onCheckoutCompleted(expanded, supabase)
      expect(spies('stripe_customers').upsertFn).toHaveBeenCalledWith(
        { user_id: 'user-123', stripe_customer_id: 'cus_abc' },
        { onConflict: 'user_id' }
      )
    })

    it('throws with session ID when user_id is missing in metadata', async () => {
      const { supabase } = mockSupabase({})
      await expect(
        onCheckoutCompleted(session({ mode: 'subscription', metadata: {} }), supabase)
      ).rejects.toThrow('cs_test_123')
    })

    it('throws with session ID when customer is missing', async () => {
      const { supabase } = mockSupabase({})
      await expect(
        onCheckoutCompleted(session({ mode: 'subscription', customer: null }), supabase)
      ).rejects.toThrow('cs_test_123')
    })

    it('throws when DB upsert fails', async () => {
      const err = new Error('db error')
      const { supabase } = mockSupabase({ stripe_customers: { upsert: { error: err } } })
      await expect(onCheckoutCompleted(session({ mode: 'subscription' }), supabase)).rejects.toThrow('db error')
    })
  })
})

describe('onCheckoutAsyncPaymentSucceeded', () => {
  it('transitions the order to paid by stripe_session_id', async () => {
    const { supabase, spies } = mockSupabase({ orders: {} })
    await onCheckoutAsyncPaymentSucceeded(session(), supabase)
    expect(spies('orders').updateFn).toHaveBeenCalledWith({ status: 'paid' })
    expect(spies('orders').updateEqFn).toHaveBeenCalledWith('stripe_session_id', 'cs_test_123')
  })

  it('throws when DB update fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ orders: { update: { error: err } } })
    await expect(onCheckoutAsyncPaymentSucceeded(session(), supabase)).rejects.toThrow('db error')
  })
})

describe('onCheckoutAsyncPaymentFailed', () => {
  it('transitions the order to failed by stripe_session_id', async () => {
    const { supabase, spies } = mockSupabase({ orders: {} })
    await onCheckoutAsyncPaymentFailed(session(), supabase)
    expect(spies('orders').updateFn).toHaveBeenCalledWith({ status: 'failed' })
    expect(spies('orders').updateEqFn).toHaveBeenCalledWith('stripe_session_id', 'cs_test_123')
  })

  it('throws when DB update fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ orders: { update: { error: err } } })
    await expect(onCheckoutAsyncPaymentFailed(session(), supabase)).rejects.toThrow('db error')
  })
})
