import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleEvent } from '../webhooks/events/index.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

vi.mock('../webhooks/events/checkout.js', () => ({
  onCheckoutCompleted: vi.fn(),
  onCheckoutAsyncPaymentSucceeded: vi.fn(),
  onCheckoutAsyncPaymentFailed: vi.fn(),
}))
vi.mock('../webhooks/events/subscription.js', () => ({
  onSubscriptionUpdated: vi.fn(),
  onSubscriptionDeleted: vi.fn(),
}))
vi.mock('../webhooks/events/invoice.js', () => ({
  onInvoicePaid: vi.fn(),
  onPaymentFailed: vi.fn(),
  onTrialWillEnd: vi.fn(),
}))

import { onCheckoutAsyncPaymentFailed, onCheckoutAsyncPaymentSucceeded, onCheckoutCompleted } from '../webhooks/events/checkout.js'
import { onSubscriptionUpdated, onSubscriptionDeleted } from '../webhooks/events/subscription.js'
import { onInvoicePaid, onPaymentFailed, onTrialWillEnd } from '../webhooks/events/invoice.js'

const mockDb = {} as SupabaseClient
const mockStripe = {} as Stripe
const event = (type: string) => ({ type, data: { object: {} } } as any)

beforeEach(() => vi.clearAllMocks())

describe('handleEvent routing', () => {
  it('checkout.session.completed → onCheckoutCompleted', async () => {
    await handleEvent(event('checkout.session.completed'), mockDb, mockStripe)
    expect(onCheckoutCompleted).toHaveBeenCalledOnce()
  })

  it('checkout.session.async_payment_succeeded → onCheckoutAsyncPaymentSucceeded', async () => {
    await handleEvent(event('checkout.session.async_payment_succeeded'), mockDb, mockStripe)
    expect(onCheckoutAsyncPaymentSucceeded).toHaveBeenCalledOnce()
  })

  it('checkout.session.async_payment_failed → onCheckoutAsyncPaymentFailed', async () => {
    await handleEvent(event('checkout.session.async_payment_failed'), mockDb, mockStripe)
    expect(onCheckoutAsyncPaymentFailed).toHaveBeenCalledOnce()
  })

  it('customer.subscription.created → onSubscriptionUpdated, with stripe client passed through', async () => {
    await handleEvent(event('customer.subscription.created'), mockDb, mockStripe)
    expect(onSubscriptionUpdated).toHaveBeenCalledWith(expect.anything(), mockDb, mockStripe)
  })

  it('customer.subscription.updated → onSubscriptionUpdated', async () => {
    await handleEvent(event('customer.subscription.updated'), mockDb, mockStripe)
    expect(onSubscriptionUpdated).toHaveBeenCalledOnce()
  })

  it('customer.subscription.deleted → onSubscriptionDeleted, with stripe client passed through', async () => {
    await handleEvent(event('customer.subscription.deleted'), mockDb, mockStripe)
    expect(onSubscriptionDeleted).toHaveBeenCalledWith(expect.anything(), mockDb, mockStripe)
  })

  it('invoice.paid → onInvoicePaid, with stripe client passed through', async () => {
    await handleEvent(event('invoice.paid'), mockDb, mockStripe)
    expect(onInvoicePaid).toHaveBeenCalledWith(expect.anything(), mockDb, mockStripe)
  })

  it('invoice.payment_failed → onPaymentFailed, with stripe client passed through', async () => {
    await handleEvent(event('invoice.payment_failed'), mockDb, mockStripe)
    expect(onPaymentFailed).toHaveBeenCalledWith(expect.anything(), mockDb, mockStripe)
  })

  it('customer.subscription.trial_will_end → onTrialWillEnd', async () => {
    await handleEvent(event('customer.subscription.trial_will_end'), mockDb, mockStripe)
    expect(onTrialWillEnd).toHaveBeenCalledOnce()
  })

  it('unknown event type returns undefined without throwing', async () => {
    const result = await handleEvent(event('completely.unknown.event'), mockDb, mockStripe)
    expect(result).toBeUndefined()
  })
})
