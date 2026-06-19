import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWebhookHandler } from '../../src/webhooks/handler.js'
import { buildWebhookRequest, stripeFixtures } from '../../src/testing.js'
import {
  db,
  skipIfNotLocal,
  WEBHOOK_SECRET,
  seedUser,
  seedCustomer,
  seedSubscription,
  cleanupUser,
  cleanupWebhookEvents,
} from './setup.js'

const handler = createWebhookHandler()

describe.skipIf(skipIfNotLocal)('subscription lifecycle handlers', () => {
  let userId: string
  let customerId: string
  const trackedEventIds: string[] = []

  beforeEach(async () => {
    userId = await seedUser()
    customerId = `cus_sub_${Date.now()}_${Math.random().toString(36).slice(2)}`
    await seedCustomer(userId, customerId)
  })

  afterEach(async () => {
    await cleanupWebhookEvents(trackedEventIds.splice(0))
    await cleanupUser(userId)
  })

  // ─── customer.subscription.created ─────────────────────────────────────────

  it('customer.subscription.created → row inserted with correct fields', async () => {
    const subId = `sub_created_${Date.now()}`
    const priceId = `price_created_${Date.now()}`
    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({
        id: subId,
        customerId,
        priceId,
        status: 'active',
      }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data, error } = await db()
      .from('subscriptions')
      .select('user_id, stripe_price_id, status, cancel_at_period_end')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(error).toBeNull()
    expect(data!.user_id).toBe(userId)
    expect(data!.stripe_price_id).toBe(priceId)
    expect(data!.status).toBe('active')
    expect(data!.cancel_at_period_end).toBe(false)
  })

  it('dahlia regression — period dates read from items.data[0], not subscription root', async () => {
    // stripeFixtures.subscription() puts period dates ONLY on items.data[0].
    // If the handler reads from subscription root (pre-dahlia), it would write
    // undefined/wrong values. This test proves the handler reads the correct location.
    const subId = `sub_dahlia_${Date.now()}`
    const periodStart = 1700000000
    const periodEnd = 1702678400
    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId, customerId, periodStart, periodEnd }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    await handler(req)

    const { data } = await db()
      .from('subscriptions')
      .select('current_period_start, current_period_end')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(data!.current_period_start).toBe(new Date(periodStart * 1000).toISOString())
    expect(data!.current_period_end).toBe(new Date(periodEnd * 1000).toISOString())
  })

  // ─── customer.subscription.updated ─────────────────────────────────────────

  it('customer.subscription.updated → existing row updated, not duplicated', async () => {
    const subId = `sub_updated_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'trialing' })

    const newPriceId = `price_updated_${Date.now()}`
    const req = buildWebhookRequest(
      'customer.subscription.updated',
      stripeFixtures.subscription({ id: subId, customerId, priceId: newPriceId, status: 'active' }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data } = await db()
      .from('subscriptions')
      .select('status, stripe_price_id')
      .eq('stripe_subscription_id', subId)
    expect(data).toHaveLength(1) // no duplicate
    expect(data![0].status).toBe('active')
    expect(data![0].stripe_price_id).toBe(newPriceId)
  })

  // ─── customer.subscription.deleted ─────────────────────────────────────────

  it('customer.subscription.deleted → status set to canceled (no-op guard: assert row existed before)', async () => {
    const subId = `sub_deleted_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'active' })

    // Guard: verify row exists before running the delete handler
    const { data: before } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(before?.status).toBe('active')

    const req = buildWebhookRequest(
      'customer.subscription.deleted',
      stripeFixtures.subscription({ id: subId, customerId, status: 'canceled' }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data: after } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(after?.status).toBe('canceled')
  })

  // ─── invoice.paid ───────────────────────────────────────────────────────────

  it('invoice.paid → status set to active, period timestamps updated (no-op guard)', async () => {
    const subId = `sub_invpaid_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'past_due' })

    // Guard: verify the row exists before the update so a silent no-op would fail
    const { data: before } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(before?.status).toBe('past_due')

    const newPeriodStart = 1705000000
    const newPeriodEnd = 1707678400
    const req = buildWebhookRequest(
      'invoice.paid',
      stripeFixtures.invoice({ subscriptionId: subId, periodStart: newPeriodStart, periodEnd: newPeriodEnd }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data: after } = await db()
      .from('subscriptions')
      .select('status, current_period_start, current_period_end')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(after?.status).toBe('active')
    expect(after?.current_period_start).toBe(new Date(newPeriodStart * 1000).toISOString())
    expect(after?.current_period_end).toBe(new Date(newPeriodEnd * 1000).toISOString())
  })

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  it('invoice.payment_failed → status set to past_due (no-op guard)', async () => {
    const subId = `sub_invfail_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'active' })

    const { data: before } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(before?.status).toBe('active')

    const req = buildWebhookRequest(
      'invoice.payment_failed',
      stripeFixtures.invoice({ subscriptionId: subId }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)

    const { data: after } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(after?.status).toBe('past_due')
  })
})
