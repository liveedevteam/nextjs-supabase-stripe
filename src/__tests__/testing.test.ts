import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { buildWebhookRequest, stripeFixtures } from '../testing.js'

const TEST_SECRET = 'whsec_dGVzdHNlY3JldA=='  // base64('testsecret')

const stripe = new Stripe('sk_test_placeholder', {
  apiVersion: '2026-05-27.dahlia',
})

describe('buildWebhookRequest', () => {
  it('produces a Request Stripe can verify with constructEvent', async () => {
    const req = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted(),
      { secret: TEST_SECRET }
    )
    const body = await req.clone().text()
    const sig = req.headers.get('stripe-signature')!

    expect(() => stripe.webhooks.constructEvent(body, sig, TEST_SECRET)).not.toThrow()
  })

  it('embeds the correct event type', async () => {
    const req = buildWebhookRequest('invoice.paid', { id: 'in_123' }, { secret: TEST_SECRET })
    const body = await req.clone().text()
    const sig = req.headers.get('stripe-signature')!
    const event = stripe.webhooks.constructEvent(body, sig, TEST_SECRET)

    expect(event.type).toBe('invoice.paid')
  })

  it('embeds the object as event.data.object', async () => {
    const object = stripeFixtures.subscription({ id: 'sub_abc', status: 'active' })
    const req = buildWebhookRequest('customer.subscription.created', object, { secret: TEST_SECRET })
    const body = await req.clone().text()
    const sig = req.headers.get('stripe-signature')!
    const event = stripe.webhooks.constructEvent(body, sig, TEST_SECRET)

    expect((event.data.object as any).id).toBe('sub_abc')
  })

  it('rejects verification with the wrong secret', async () => {
    const req = buildWebhookRequest('invoice.paid', {}, { secret: TEST_SECRET })
    const body = await req.clone().text()
    const sig = req.headers.get('stripe-signature')!

    expect(() =>
      stripe.webhooks.constructEvent(body, sig, 'whsec_d3JvbmdzZWNyZXQ=')
    ).toThrow()
  })

  it('accepts a plain string secret without whsec_ prefix', async () => {
    const plainSecret = 'my_test_signing_secret'
    const req = buildWebhookRequest('invoice.paid', {}, { secret: plainSecret })
    const body = await req.clone().text()
    const sig = req.headers.get('stripe-signature')!

    expect(() => stripe.webhooks.constructEvent(body, sig, plainSecret)).not.toThrow()
  })
})

describe('stripeFixtures.checkoutSessionCompleted', () => {
  it('includes metadata.user_id when userId is provided', () => {
    const obj = stripeFixtures.checkoutSessionCompleted({ userId: 'user-123' })
    expect((obj.metadata as any).user_id).toBe('user-123')
  })

  it('sets metadata.user_id to null for anonymous checkout', () => {
    const obj = stripeFixtures.checkoutSessionCompleted({ userId: null })
    expect((obj.metadata as any).user_id).toBeNull()
  })

  it('uses empty metadata when userId is omitted', () => {
    const obj = stripeFixtures.checkoutSessionCompleted()
    expect(obj.metadata).toEqual({})
  })
})

describe('stripeFixtures.subscription', () => {
  it('places period dates on the item, not the subscription root (dahlia shape)', () => {
    const obj = stripeFixtures.subscription({ periodStart: 1700000000, periodEnd: 1702678400 })
    const item = obj.items.data[0]
    expect(item.current_period_start).toBe(1700000000)
    expect(item.current_period_end).toBe(1702678400)
    // Should NOT be on the root
    expect((obj as any).current_period_start).toBeUndefined()
  })

  it('includes cancel_at when set', () => {
    const obj = stripeFixtures.subscription({ cancelAt: 1705356800 })
    expect(obj.cancel_at).toBe(1705356800)
  })
})

describe('stripeFixtures.invoice', () => {
  it('places subscriptionId at parent.subscription_details.subscription (dahlia shape)', () => {
    const obj = stripeFixtures.invoice({ subscriptionId: 'sub_123' })
    expect((obj.parent as any).subscription_details.subscription).toBe('sub_123')
    // Should NOT be at invoice.subscription
    expect((obj as any).subscription).toBeUndefined()
  })

  it('sets parent to null for non-subscription invoices', () => {
    const obj = stripeFixtures.invoice()
    expect(obj.parent).toBeNull()
  })
})
