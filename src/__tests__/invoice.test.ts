import { describe, it, expect, vi } from 'vitest'
import { onInvoicePaid, onPaymentFailed, onTrialWillEnd } from '../webhooks/events/invoice.js'
import { mockSupabase } from './helpers.js'
import type Stripe from 'stripe'

const SUB_ID = 'sub_123'
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

describe('onInvoicePaid', () => {
  it('updates status to active and writes period timestamps', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onInvoicePaid(invoice(), supabase)
    expect(spies('subscriptions').updateFn).toHaveBeenCalledWith({
      status: 'active',
      current_period_start: new Date(PERIOD_START * 1000).toISOString(),
      current_period_end: new Date(PERIOD_END * 1000).toISOString(),
    })
    expect(spies('subscriptions').updateEqFn).toHaveBeenCalledWith('stripe_subscription_id', SUB_ID)
  })

  it('extracts subscription ID from an expanded Subscription object', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    const expandedInvoice = invoice({
      parent: { subscription_details: { subscription: { id: SUB_ID } as any } } as any,
    })
    await onInvoicePaid(expandedInvoice, supabase)
    expect(spies('subscriptions').updateEqFn).toHaveBeenCalledWith('stripe_subscription_id', SUB_ID)
  })

  it('returns early without touching DB when invoice has no subscription parent (dahlia regression)', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onInvoicePaid(invoice({ parent: null }), supabase)
    expect(spies('subscriptions').updateFn).not.toHaveBeenCalled()
  })

  it('throws when DB update fails', async () => {
    const err = new Error('db error')
    const { supabase } = mockSupabase({ subscriptions: { update: { error: err } } })
    await expect(onInvoicePaid(invoice(), supabase)).rejects.toThrow('db error')
  })
})

describe('onPaymentFailed', () => {
  it('updates status to past_due', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onPaymentFailed(invoice(), supabase)
    expect(spies('subscriptions').updateFn).toHaveBeenCalledWith({ status: 'past_due' })
    expect(spies('subscriptions').updateEqFn).toHaveBeenCalledWith('stripe_subscription_id', SUB_ID)
  })

  it('returns early when invoice has no subscription', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onPaymentFailed(invoice({ parent: null }), supabase)
    expect(spies('subscriptions').updateFn).not.toHaveBeenCalled()
  })
})

describe('onTrialWillEnd', () => {
  it('is a no-op and does not touch the database', async () => {
    const { supabase, spies } = mockSupabase({ subscriptions: {} })
    await onTrialWillEnd({} as Stripe.Subscription, supabase)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
