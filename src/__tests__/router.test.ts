import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleEvent } from '../webhooks/events/index.js'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../webhooks/events/checkout.js', () => ({ onCheckoutCompleted: vi.fn() }))
vi.mock('../webhooks/events/subscription.js', () => ({
  onSubscriptionUpdated: vi.fn(),
  onSubscriptionDeleted: vi.fn(),
}))
vi.mock('../webhooks/events/invoice.js', () => ({
  onInvoicePaid: vi.fn(),
  onPaymentFailed: vi.fn(),
  onTrialWillEnd: vi.fn(),
}))

import { onCheckoutCompleted } from '../webhooks/events/checkout.js'
import { onSubscriptionUpdated, onSubscriptionDeleted } from '../webhooks/events/subscription.js'
import { onInvoicePaid, onPaymentFailed, onTrialWillEnd } from '../webhooks/events/invoice.js'

const mockDb = {} as SupabaseClient
const event = (type: string) => ({ type, data: { object: {} } } as any)

beforeEach(() => vi.clearAllMocks())

describe('handleEvent routing', () => {
  it('checkout.session.completed → onCheckoutCompleted', async () => {
    await handleEvent(event('checkout.session.completed'), mockDb)
    expect(onCheckoutCompleted).toHaveBeenCalledOnce()
  })

  it('customer.subscription.created → onSubscriptionUpdated', async () => {
    await handleEvent(event('customer.subscription.created'), mockDb)
    expect(onSubscriptionUpdated).toHaveBeenCalledOnce()
  })

  it('customer.subscription.updated → onSubscriptionUpdated', async () => {
    await handleEvent(event('customer.subscription.updated'), mockDb)
    expect(onSubscriptionUpdated).toHaveBeenCalledOnce()
  })

  it('customer.subscription.deleted → onSubscriptionDeleted', async () => {
    await handleEvent(event('customer.subscription.deleted'), mockDb)
    expect(onSubscriptionDeleted).toHaveBeenCalledOnce()
  })

  it('invoice.paid → onInvoicePaid', async () => {
    await handleEvent(event('invoice.paid'), mockDb)
    expect(onInvoicePaid).toHaveBeenCalledOnce()
  })

  it('invoice.payment_failed → onPaymentFailed', async () => {
    await handleEvent(event('invoice.payment_failed'), mockDb)
    expect(onPaymentFailed).toHaveBeenCalledOnce()
  })

  it('customer.subscription.trial_will_end → onTrialWillEnd', async () => {
    await handleEvent(event('customer.subscription.trial_will_end'), mockDb)
    expect(onTrialWillEnd).toHaveBeenCalledOnce()
  })

  it('unknown event type returns undefined without throwing', async () => {
    const result = await handleEvent(event('completely.unknown.event'), mockDb)
    expect(result).toBeUndefined()
  })
})
