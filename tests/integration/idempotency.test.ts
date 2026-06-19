import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWebhookHandler } from '../../src/webhooks/handler.js'
import { buildWebhookRequest, stripeFixtures } from '../../src/testing.js'
import {
  db,
  skipIfNotLocal,
  WEBHOOK_SECRET,
  seedUser,
  seedCustomer,
  cleanupUser,
  cleanupWebhookEvents,
} from './setup.js'

const handler = createWebhookHandler()

describe.skipIf(skipIfNotLocal)('idempotency — webhook_events UNIQUE constraint', () => {
  let userId: string
  let customerId: string
  const trackedEventIds: string[] = []

  beforeEach(async () => {
    userId = await seedUser()
    customerId = `cus_idem_${Date.now()}_${Math.random().toString(36).slice(2)}`
    await seedCustomer(userId, customerId)
  })

  afterEach(async () => {
    await cleanupWebhookEvents(trackedEventIds.splice(0))
    await cleanupUser(userId)
  })

  it('same event ID processed twice → second returns 200 Already processed, subscriptions table unchanged', async () => {
    const subId = `sub_idem_${Date.now()}`
    const priceId = 'price_idem_test'

    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId, customerId, priceId, status: 'active' }),
      { secret: WEBHOOK_SECRET },
    )
    // Clone before first handler call consumes the body
    const req2 = req.clone()
    const eventId = JSON.parse(await req.clone().text()).id
    trackedEventIds.push(eventId)

    // First delivery
    const res1 = await handler(req)
    expect(res1.status).toBe(200)
    expect(await res1.text()).toBe('OK')

    // Verify subscription was written
    const { data: firstState } = await db()
      .from('subscriptions')
      .select('status, stripe_price_id')
      .eq('stripe_subscription_id', subId)
    expect(firstState).toHaveLength(1)
    expect(firstState![0].status).toBe('active')

    // Second delivery — same event ID, different Request object (same body/sig as Stripe retry)
    const res2 = await handler(req2)
    expect(res2.status).toBe(200)
    expect(await res2.text()).toBe('Already processed')

    // Subscriptions table must be identical — onSubscriptionUpdated was NOT called again
    const { data: secondState } = await db()
      .from('subscriptions')
      .select('status, stripe_price_id')
      .eq('stripe_subscription_id', subId)
    expect(secondState).toHaveLength(1)
    expect(secondState![0]).toEqual(firstState![0])
  })

  it('two events with different IDs but same subscription ID → both processed, last write wins', async () => {
    const subId = `sub_twoevt_${Date.now()}`

    const reqA = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId, customerId, priceId: 'price_v1', status: 'active' }),
      { secret: WEBHOOK_SECRET },
    )
    const reqB = buildWebhookRequest(
      'customer.subscription.updated',
      stripeFixtures.subscription({ id: subId, customerId, priceId: 'price_v2', status: 'trialing' }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await reqA.clone().text()).id)
    trackedEventIds.push(JSON.parse(await reqB.clone().text()).id)

    await handler(reqA)
    await handler(reqB)

    // Both events processed; upsert means the second one overwrites the first
    const { data } = await db()
      .from('subscriptions')
      .select('status, stripe_price_id')
      .eq('stripe_subscription_id', subId)
    expect(data).toHaveLength(1) // one row, not two
    expect(data![0].stripe_price_id).toBe('price_v2')
    expect(data![0].status).toBe('trialing')
  })
})
