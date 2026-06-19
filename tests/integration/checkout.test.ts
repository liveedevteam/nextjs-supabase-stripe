import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWebhookHandler } from '../../src/webhooks/handler.js'
import { buildWebhookRequest, stripeFixtures } from '../../src/testing.js'
import {
  db,
  skipIfNotLocal,
  WEBHOOK_SECRET,
  seedUser,
  cleanupUser,
  cleanupOrders,
  cleanupWebhookEvents,
} from './setup.js'

const handler = createWebhookHandler()

describe.skipIf(skipIfNotLocal)('checkout.session.completed handler', () => {
  let userId: string
  const trackedEventIds: string[] = []
  const trackedSessionIds: string[] = []

  beforeEach(async () => {
    userId = await seedUser()
  })

  afterEach(async () => {
    await cleanupOrders(trackedSessionIds.splice(0))
    await cleanupWebhookEvents(trackedEventIds.splice(0))
    await cleanupUser(userId)
  })

  it('payment mode + anonymous user → inserts order with user_id null', async () => {
    const sessionId = `cs_anon_${Date.now()}`
    trackedSessionIds.push(sessionId)
    const req = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({
        id: sessionId,
        mode: 'payment',
        userId: null,
        amountTotal: 4900,
        currency: 'usd',
      }),
      { secret: WEBHOOK_SECRET },
    )
    const body = await req.clone().text()
    trackedEventIds.push(JSON.parse(body).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data, error } = await db()
      .from('orders')
      .select('user_id, amount, currency, status')
      .eq('stripe_session_id', sessionId)
      .single()
    expect(error).toBeNull()
    expect(data!.user_id).toBeNull()
    expect(data!.amount).toBe(4900)
    expect(data!.currency).toBe('usd')
    expect(data!.status).toBe('paid')
  })

  it('payment mode + authenticated user → inserts order with correct user_id', async () => {
    const sessionId = `cs_auth_${Date.now()}`
    trackedSessionIds.push(sessionId)
    const req = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({
        id: sessionId,
        mode: 'payment',
        userId,
        amountTotal: 2000,
      }),
      { secret: WEBHOOK_SECRET },
    )
    const body = await req.clone().text()
    trackedEventIds.push(JSON.parse(body).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data } = await db()
      .from('orders')
      .select('user_id')
      .eq('stripe_session_id', sessionId)
      .single()
    expect(data!.user_id).toBe(userId)
  })

  it('subscription mode → upserts stripe_customers row linking user to Stripe customer', async () => {
    const sessionId = `cs_sub_${Date.now()}`
    const customerId = `cus_chk_${Date.now()}`
    // orders table is not written for subscription mode; no tracked sessionId needed
    const req = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({
        id: sessionId,
        mode: 'subscription',
        userId,
        customerId,
      }),
      { secret: WEBHOOK_SECRET },
    )
    const body = await req.clone().text()
    trackedEventIds.push(JSON.parse(body).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data, error } = await db()
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()
    expect(error).toBeNull()
    expect(data!.stripe_customer_id).toBe(customerId)
  })

  it('subscription mode idempotent — second identical checkout upserts, does not duplicate row', async () => {
    const sessionIdA = `cs_sub_a_${Date.now()}`
    const sessionIdB = `cs_sub_b_${Date.now()}`
    const customerId = `cus_upsert_${Date.now()}`

    const reqA = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({ id: sessionIdA, mode: 'subscription', userId, customerId }),
      { secret: WEBHOOK_SECRET },
    )
    const reqB = buildWebhookRequest(
      'checkout.session.completed',
      stripeFixtures.checkoutSessionCompleted({ id: sessionIdB, mode: 'subscription', userId, customerId }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await reqA.clone().text()).id)
    trackedEventIds.push(JSON.parse(await reqB.clone().text()).id)

    await handler(reqA)
    await handler(reqB)

    const { data } = await db()
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
    expect(data).toHaveLength(1)
    expect(data![0].stripe_customer_id).toBe(customerId)
  })
})
