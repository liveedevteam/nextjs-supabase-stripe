# nextjs-supabase-stripe — AI context for Claude Code

This file is loaded automatically by Claude Code when this package is installed.
It helps Claude give accurate assistance when you work with `nextjs-supabase-stripe`.

---

## What this package exports

```ts
import { createCheckout, getBillingPortal, getSubscription, requireActiveSubscription, changeSubscription, cancelSubscription, UnauthorizedError, CustomerNotFoundError, NoActiveSubscriptionError, DatabaseError, InvalidRedirectUrlError } from 'nextjs-supabase-stripe/actions'
import { createWebhookHandler } from 'nextjs-supabase-stripe/webhooks'
import { buildWebhookRequest, stripeFixtures } from 'nextjs-supabase-stripe/testing'
import type { Subscription, Database } from 'nextjs-supabase-stripe/types'
```

---

## Server Actions

All actions are `'use server'` and read the user session from cookies via `@supabase/ssr`.
They must be called from Next.js Server Components or Server Actions — not from client components directly.

### `createCheckout(priceId, mode)`

```ts
createCheckout(priceId: string, mode: 'payment' | 'subscription'): Promise<never>
```

- Redirects to Stripe Checkout. Never returns — always throws a redirect.
- `mode: 'payment'` — anonymous users allowed. Order recorded with `user_id = null`.
- `mode: 'subscription'` — throws `UnauthorizedError` if not logged in.
- Sets `metadata.user_id` on the Stripe session when user is logged in.
- Throws `InvalidRedirectUrlError` if `NEXT_PUBLIC_APP_URL` is unset or not a valid absolute URL.
- Throws `DatabaseError` if the existing-customer lookup fails for a reason other than "no row" — never silently falls through to creating a duplicate Stripe customer.

### `getBillingPortal()`

```ts
getBillingPortal(): Promise<never>
```

- Redirects to Stripe Billing Portal. Requires a logged-in user with an existing `stripe_customers` record.
- Throws `UnauthorizedError` if not logged in.
- Throws `CustomerNotFoundError` if the user has no Stripe customer yet (hasn't completed a subscription checkout).
- Throws `DatabaseError` if the customer lookup itself fails — never reported as `CustomerNotFoundError`.
- Throws `InvalidRedirectUrlError` if `NEXT_PUBLIC_APP_URL` is unset or not a valid absolute URL.

### `getSubscription()`

```ts
getSubscription(): Promise<Subscription | null>
```

- Returns the user's most recent non-terminal subscription row from `subscriptions` table, or `null`.
- Filters out `canceled` and `incomplete_expired` rows. Returns the row with the latest `current_period_end`.
- Safe to call for anonymous users — returns `null`.
- Returns `null` only when the user genuinely has no matching row. Throws `DatabaseError` if the query itself fails — a database outage is never reported as "no subscription".

### `requireActiveSubscription()`

```ts
requireActiveSubscription(): Promise<void>
```

- Redirects to `/pricing` if the user has no active or trialing subscription.
- Accepts `status = 'active'` or `status = 'trialing'` — users in a free trial are allowed through.
- Safe for anonymous users — they get redirected to `/pricing`.

### `cancelSubscription(immediately?)`

```ts
cancelSubscription(immediately?: boolean): Promise<void>
```

- Cancels the user's current subscription.
- `immediately = false` (default): sets `cancel_at_period_end: true` — user keeps access until end of billing period. Stripe fires `customer.subscription.updated`.
- `immediately = true`: calls `stripe.subscriptions.cancel` — access cut off immediately. Stripe fires `customer.subscription.deleted`.
- In both cases the DB is updated automatically by the existing webhook handlers.
- Throws `UnauthorizedError` if not logged in.
- Throws `NoActiveSubscriptionError` if no `active`, `trialing`, or `past_due` subscription exists.
- Throws `DatabaseError` if the subscription lookup itself fails.

### `changeSubscription(newPriceId, prorationBehavior?)`

```ts
changeSubscription(
  newPriceId: string,
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice'
): Promise<void>
```

- Upgrades or downgrades the user's current subscription to a new price.
- Throws `UnauthorizedError` if not logged in.
- Throws `NoActiveSubscriptionError` if the user has no `active`, `trialing`, or `past_due` subscription.
- Throws `DatabaseError` if the subscription lookup itself fails.
- `prorationBehavior` defaults to `'create_prorations'` (credit/charge deferred to next invoice).
- Does NOT redirect. Returns `Promise<void>` — call from a Server Action wrapper.
- The DB is updated automatically when Stripe fires `customer.subscription.updated`.

---

## Webhook Handler

```ts
createWebhookHandler(options?: { slack?: { webhookUrl: string; channel?: string } }): (req: Request) => Promise<Response>
```

- Always use `req.text()` internally — never `req.json()` — for Stripe signature verification.
- Idempotent: checks `webhook_events` table before processing; skips already-processed events.
- Slack config is optional — omit entirely to disable failure notifications.

Mount it:

```ts
// app/api/webhooks/stripe/route.ts
export const POST = createWebhookHandler()
// or with Slack:
export const POST = createWebhookHandler({ slack: { webhookUrl: process.env.SLACK_WEBHOOK_URL! } })
```

---

## Anonymous user behaviour

| Function | Not logged in |
|---|---|
| `createCheckout('payment')` | Proceeds — `user_id = null` in DB |
| `createCheckout('subscription')` | Throws `UnauthorizedError` |
| `getBillingPortal()` | Throws `UnauthorizedError` |
| `getSubscription()` | Returns `null` |
| `requireActiveSubscription()` | Redirects to `/pricing` |
| `changeSubscription(priceId)` | Throws `UnauthorizedError` |
| `cancelSubscription()` | Throws `UnauthorizedError` |

**Important:** Never render `<CheckoutButton mode="subscription">` or `<BillingPortalButton>` for anonymous users without a session guard — they will throw on submit.

---

## Database tables written by this package

| Table | Written by | Key columns |
|---|---|---|
| `orders` | `checkout.session.completed` (payment), `checkout.session.async_payment_succeeded/failed` | `user_id` (nullable), `stripe_session_id`, `amount`, `status` (`pending` \| `paid` \| `failed`) |
| `stripe_customers` | `checkout.session.completed` (subscription) | `user_id`, `stripe_customer_id` |
| `subscriptions` | `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` — all fetch the subscription fresh from Stripe and upsert the returned state, never the event payload | `user_id`, `status`, `stripe_subscription_id` |
| `webhook_events` | Every processed event | `id`, `type` (idempotency) |

`orders.status` starts `pending` when `payment_status !== 'paid'` at checkout (delayed payment methods like
bank debits) and transitions to `paid`/`failed` on the matching async event. `subscriptions.status` always
reflects Stripe's current live state — out-of-order webhook delivery can't regress it.

---

## Environment variables required

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SLACK_WEBHOOK_URL   # optional
```

Each is validated lazily, the first time it's actually needed (not at import time — importing this
package must never break a Next.js build before real env vars are available). A missing variable
throws `MissingEnvironmentVariableError` listing every missing variable for that call, not just the
first one found.

---

## Common mistakes

- **Calling `createCheckout` or `getBillingPortal` from a client component** — these are server actions, call them via a `<form action={...}>` or from a server action wrapper.
- **Using `getUser()` on a service-role Supabase client** — it always returns null server-side. This package already handles auth correctly; don't replicate the pattern with a service-role singleton.
- **Calling `req.json()` in a webhook handler** — breaks Stripe signature verification. This package uses `req.text()` correctly.
- **Showing subscription/portal buttons to anonymous users without a guard** — they throw on submit. Check session before rendering.
- **Forgetting `STRIPE_WEBHOOK_SECRET`** — the webhook handler returns `500` with a message naming the missing variable (not a misleading `400 Invalid signature`).
- **Matching on `error.message` instead of `instanceof`** — this package exports typed errors (`UnauthorizedError`, `CustomerNotFoundError`, `NoActiveSubscriptionError`, `DatabaseError`, `InvalidRedirectUrlError`) from `nextjs-supabase-stripe/actions`. Prefer `if (e instanceof UnauthorizedError)` over `if (e.message === 'Unauthorized')`.

---

## Testing helpers

```ts
import { buildWebhookRequest, stripeFixtures } from 'nextjs-supabase-stripe/testing'
```

- `buildWebhookRequest(eventType, object, options?)` — builds a signed `Request` with correct `stripe-signature` header. Pass directly to your route handler in tests.
- `stripeFixtures` — pre-built event objects in the `2026-05-27.dahlia` API shape:
  - `stripeFixtures.checkoutSessionCompleted(opts?)` — `checkout.session.completed`
  - `stripeFixtures.subscription(opts?)` — `customer.subscription.created/updated/deleted` (periods on `items.data[0]`)
  - `stripeFixtures.invoice(opts?)` — `invoice.paid/payment_failed` (subscription ID at `parent.subscription_details.subscription`)

```ts
// Example: unit-test your webhook route
const req = buildWebhookRequest(
  'checkout.session.completed',
  stripeFixtures.checkoutSessionCompleted({ mode: 'subscription', userId: 'user-1' }),
  { secret: process.env.STRIPE_WEBHOOK_SECRET! }
)
const res = await POST(req)
expect(res.status).toBe(200)
```

---

## Backfill script

```bash
node node_modules/nextjs-supabase-stripe/dist/scripts/backfill.js --dry-run   # preview, no writes
node node_modules/nextjs-supabase-stripe/dist/scripts/backfill.js            # run for real
```

- Syncs existing Stripe customers into the `stripe_customers` table by looking them up in Stripe by email. **Does not create new customers** — only records users who already exist in Stripe.
- Run against staging first. Throttled to one user per 200 ms to avoid Stripe rate limits.
- Never guesses on an ambiguous match (multiple Stripe customers sharing one email) — reports it for manual review instead.
- Prints a summary (matched, already synced, no email, no Stripe customer, ambiguous, failed) and exits non-zero if any user failed for a real reason (DB or Stripe error) — a user with no matching Stripe customer is not a failure.

---

## Automated setup skill

This package ships a Claude Code skill that fully sets up the integration in your project —
migration, webhook route, env vars, and backfill warning — in one step.

To use it, say:

```
set up stripe
```

The skill file is at `node_modules/nextjs-supabase-stripe/SKILL.md`.
