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
  seedSubscription,
  cleanupUser,
  cleanupWebhookEvents,
} from './setup.js'

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

  it('customer.subscription.created → fetches the subscription from Stripe and writes it', async () => {
    const subId = `sub_created_${Date.now()}`
    const priceId = `price_created_${Date.now()}`
    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, priceId, status: 'active' }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    // The event payload only needs to carry the ID — everything else written
    // to the DB comes from stripe.subscriptions.retrieve(), not this payload.
    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId, customerId }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(subId)

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
    // If the sync function read from subscription root (pre-dahlia), it would
    // write undefined/wrong values. This test proves it reads the correct location.
    const subId = `sub_dahlia_${Date.now()}`
    const periodStart = 1700000000
    const periodEnd = 1702678400
    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, periodStart, periodEnd }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    const req = buildWebhookRequest(
      'customer.subscription.created',
      stripeFixtures.subscription({ id: subId, customerId }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    await handler(req)

    const { data } = await db()
      .from('subscriptions')
      .select('current_period_start, current_period_end')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(new Date(data!.current_period_start!).toISOString()).toBe(new Date(periodStart * 1000).toISOString())
    expect(new Date(data!.current_period_end!).toISOString()).toBe(new Date(periodEnd * 1000).toISOString())
  })

  // ─── customer.subscription.updated ─────────────────────────────────────────

  it('customer.subscription.updated → existing row updated, not duplicated', async () => {
    const subId = `sub_updated_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'trialing' })

    const newPriceId = `price_updated_${Date.now()}`
    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, priceId: newPriceId, status: 'active' }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    const req = buildWebhookRequest(
      'customer.subscription.updated',
      stripeFixtures.subscription({ id: subId, customerId }),
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

  it('customer.subscription.deleted → status set to canceled — subscriptions are never hard-deleted in Stripe, retrieve() still resolves', async () => {
    const subId = `sub_deleted_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'active' })

    // Guard: verify row exists before running the delete handler
    const { data: before } = await db()
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(before?.status).toBe('active')

    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, status: 'canceled' }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    const req = buildWebhookRequest(
      'customer.subscription.deleted',
      stripeFixtures.subscription({ id: subId, customerId }),
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

  it('invoice.paid → fetches the subscription and writes its current status and period timestamps', async () => {
    const subId = `sub_invpaid_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'past_due' })

    const newPeriodStart = 1705000000
    const newPeriodEnd = 1707678400
    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({
        id: subId,
        customerId,
        status: 'active',
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
      }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    const req = buildWebhookRequest(
      'invoice.paid',
      stripeFixtures.invoice({ subscriptionId: subId }),
      { secret: WEBHOOK_SECRET },
    )
    trackedEventIds.push(JSON.parse(await req.clone().text()).id)

    const res = await handler(req)
    expect(res.status).toBe(200)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(subId)

    const { data: after } = await db()
      .from('subscriptions')
      .select('status, current_period_start, current_period_end')
      .eq('stripe_subscription_id', subId)
      .single()
    expect(after?.status).toBe('active')
    expect(new Date(after!.current_period_start!).toISOString()).toBe(new Date(newPeriodStart * 1000).toISOString())
    expect(new Date(after!.current_period_end!).toISOString()).toBe(new Date(newPeriodEnd * 1000).toISOString())
  })

  it('cannot reactivate a subscription Stripe has since canceled — a delayed invoice.paid writes the fetched (canceled) status', async () => {
    const subId = `sub_delayed_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'canceled' })

    // Stripe's live state says canceled — an invoice.paid event that was
    // queued/retried from before the cancellation must not undo it.
    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, status: 'canceled' }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

    const req = buildWebhookRequest(
      'invoice.paid',
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
    expect(after?.status).toBe('canceled')
  })

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  it('invoice.payment_failed → fetches the subscription and writes whatever status Stripe put it in', async () => {
    const subId = `sub_invfail_${Date.now()}`
    await seedSubscription({ userId, stripeSubscriptionId: subId, status: 'active' })

    const stripe = stripeStub({
      [subId]: stripeFixtures.subscription({ id: subId, customerId, status: 'past_due' }) as unknown as Stripe.Subscription,
    })
    const handler = createWebhookHandler({ stripe })

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
