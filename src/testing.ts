import { createHmac } from 'crypto'

// ─── Webhook request builder ─────────────────────────────────────────────────

export interface BuildWebhookRequestOptions {
  /**
   * The webhook signing secret — accepts both raw and whsec_-prefixed format.
   * Must match the value used in createWebhookHandler.
   * Default: 'whsec_test_secret'
   */
  secret?: string
  /** Unix timestamp for the Stripe-Signature header. Defaults to now. */
  timestamp?: number
}

/**
 * Builds a signed `Request` that looks exactly like a Stripe webhook delivery.
 * Pass the returned request directly to your `POST` route handler in tests.
 *
 * @example
 * const req = buildWebhookRequest(
 *   'checkout.session.completed',
 *   stripeFixtures.checkoutSessionCompleted({ mode: 'subscription', userId: 'user-1' }),
 *   { secret: process.env.STRIPE_WEBHOOK_SECRET! }
 * )
 * const res = await POST(req)
 * expect(res.status).toBe(200)
 */
export function buildWebhookRequest(
  eventType: string,
  object: Record<string, unknown>,
  options: BuildWebhookRequestOptions = {}
): Request {
  const secret = options.secret ?? 'whsec_test_secret'
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)

  const event = {
    id: `evt_test_${randomHex()}`,
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created: timestamp,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: eventType,
    data: { object },
  }

  const body = JSON.stringify(event)
  const stripeSignature = sign(secret, `${timestamp}.${body}`)
  const signatureHeader = `t=${timestamp},v1=${stripeSignature}`

  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signatureHeader,
    },
    body,
  })
}

// ─── Event object fixtures ────────────────────────────────────────────────────

export interface CheckoutSessionCompletedOpts {
  id?: string
  mode?: 'payment' | 'subscription'
  /** Pass null explicitly for anonymous checkout. */
  userId?: string | null
  customerId?: string
  amountTotal?: number
  currency?: string
  /** Default: 'paid'. Pass 'unpaid' to simulate a delayed payment method (bank debit, etc). */
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required'
}

export interface SubscriptionOpts {
  id?: string
  customerId?: string
  status?: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid' | 'paused'
  priceId?: string
  periodStart?: number
  periodEnd?: number
  cancelAtPeriodEnd?: boolean
  cancelAt?: number | null
}

export interface InvoiceOpts {
  customerId?: string
  /** Pass undefined to produce a non-subscription invoice (no parent). */
  subscriptionId?: string
  periodStart?: number
  periodEnd?: number
}

/**
 * Pre-built Stripe event objects in the 2026-05-27.dahlia API shape.
 *
 * Period dates live on `items.data[0]`, not on the subscription root.
 * Invoice subscription ID lives at `parent.subscription_details.subscription`.
 *
 * Pass the return value of any fixture as the `object` argument to
 * `buildWebhookRequest`.
 */
export const stripeFixtures = {
  /** `checkout.session.completed` event object */
  checkoutSessionCompleted(opts: CheckoutSessionCompletedOpts = {}) {
    const hasUser = 'userId' in opts
    return {
      id: opts.id ?? 'cs_test_fixture',
      object: 'checkout.session',
      mode: opts.mode ?? 'payment',
      customer: opts.customerId ?? 'cus_fixture',
      amount_total: opts.amountTotal ?? 2000,
      currency: opts.currency ?? 'usd',
      payment_status: opts.paymentStatus ?? 'paid',
      ...(hasUser ? { metadata: { user_id: opts.userId } } : { metadata: {} }),
    }
  },

  /** `customer.subscription.created/updated/deleted` event object — dahlia shape */
  subscription(opts: SubscriptionOpts = {}) {
    const periodStart = opts.periodStart ?? 1700000000
    const periodEnd = opts.periodEnd ?? 1702678400
    return {
      id: opts.id ?? 'sub_fixture',
      object: 'subscription',
      customer: opts.customerId ?? 'cus_fixture',
      status: opts.status ?? 'active',
      cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
      cancel_at: opts.cancelAt ?? null,
      items: {
        object: 'list',
        data: [
          {
            id: 'si_fixture',
            object: 'subscription_item',
            price: { id: opts.priceId ?? 'price_fixture' },
            // dahlia: period dates are on the item, not on the subscription root
            current_period_start: periodStart,
            current_period_end: periodEnd,
          },
        ],
      },
    }
  },

  /** `invoice.paid` / `invoice.payment_failed` event object — dahlia shape */
  invoice(opts: InvoiceOpts = {}) {
    return {
      id: 'in_fixture',
      object: 'invoice',
      customer: opts.customerId ?? 'cus_fixture',
      period_start: opts.periodStart ?? 1700000000,
      period_end: opts.periodEnd ?? 1702678400,
      // dahlia: subscription ID lives at parent.subscription_details.subscription
      parent: opts.subscriptionId != null
        ? { subscription_details: { subscription: opts.subscriptionId } }
        : null,
    }
  },
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Stripe's constructEvent uses the raw secret string as the HMAC key (no base64 decoding)
function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function randomHex(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
}
