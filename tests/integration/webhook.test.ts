import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWebhookHandler } from '../../src/webhooks/handler.js'
import { buildWebhookRequest, stripeFixtures } from '../../src/testing.js'
import type Stripe from 'stripe'
import {
  db,
  skipIfNotLocal,
  stripeStub,
  WEBHOOK_SECRET,
  seedUser,
  seedCustomer,
  cleanupUser,
  cleanupOrders,
  cleanupWebhookEvents,
} from './setup.js'

const handler = createWebhookHandler()

describe.skipIf(skipIfNotLocal)('webhook handler', () => {
  let userId: string
  let customerId: string
  const trackedEventIds: string[] = []
  const trackedSessionIds: string[] = []

  beforeEach(async () => {
    userId = await seedUser()
    customerId = `cus_wh_${Date.now()}`
    await seedCustomer(userId, customerId)
  })

  afterEach(async () => {
    await cleanupOrders(trackedSessionIds.splice(0))
    await cleanupWebhookEvents(trackedEventIds.splice(0))
    await cleanupUser(userId)
  })

  it('valid event → 200 and row written to webhook_events', async () => {
    const sessionId = `cs_wh_valid_${Date.now()}`
    trackedSessionIds.push(sessionId)
    const req = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({ id: sessionId, mode: 'payment', userId: null }),
      { secret: WEBHOOK_SECRET },
    )
    const body = await req.clone().text()
    const eventId = JSON.parse(body).id
    trackedEventIds.push(eventId)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data, error } = await db()
      .from('webhook_events')
      .select('id, type')
      .eq('id', eventId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].type).toBe('checkout.session.completed')
  })

  it('invalid signature → 400, no webhook_event row written', async () => {
    const req = new Request('https://example.com/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234567890,v1=badc0ffee',
      },
      body: JSON.stringify({ id: 'evt_invalid', type: 'checkout.session.completed' }),
    })

    const res = await handler(req)
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid signature')

    const { data } = await db()
      .from('webhook_events')
      .select('id')
      .eq('id', 'evt_invalid')
    expect(data).toHaveLength(0)
  })

  it('handler throws → 500 and claim row deleted so Stripe can retry', async () => {
    // Stripe's live state for this subscription belongs to a customer with no
    // stripe_customers row, so resolveUserId throws "No user found for
    // customer" once syncSubscriptionFromStripe fetches it — a real handler error.
    const subId = 'sub_fixture'
    const stripeWithOrphan = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId: 'cus_orphan_no_such_customer' }) as unknown as Stripe.Subscription,
    })
    const orphanHandler = createWebhookHandler({ stripe: stripeWithOrphan })

    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId }),
      { secret: WEBHOOK_SECRET },
    )
    const body = await req.clone().text()
    const eventId = JSON.parse(body).id
    // Do NOT push to trackedEventIds — the handler should delete it; afterEach should be a no-op

    const res = await orphanHandler(req)
    expect(res.status).toBe(500)

    // Claim must be deleted so Stripe retries the event
    const { data } = await db()
      .from('webhook_events')
      .select('id')
      .eq('id', eventId)
    expect(data).toHaveLength(0)
  })
})
