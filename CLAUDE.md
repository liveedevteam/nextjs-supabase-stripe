# @liveedevteam/stripe — AI context for Claude Code

This file is loaded automatically by Claude Code when this package is installed.
It helps Claude give accurate assistance when you work with `@liveedevteam/stripe`.

---

## What this package exports

```ts
import { createCheckout, getBillingPortal, getSubscription, requireActiveSubscription } from '@liveedevteam/stripe/actions'
import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'
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
- `mode: 'subscription'` — throws `Error('Unauthorized')` if not logged in.
- Sets `metadata.user_id` on the Stripe session when user is logged in.

### `getBillingPortal()`

```ts
getBillingPortal(): Promise<never>
```

- Redirects to Stripe Billing Portal. Requires a logged-in user with an existing `stripe_customers` record.
- Throws `Error('Unauthorized')` if not logged in.
- Throws `Error('No Stripe customer found for this user')` if the user has no Stripe customer yet (hasn't completed a subscription checkout).

### `getSubscription()`

```ts
getSubscription(): Promise<Subscription | null>
```

- Returns the user's active subscription row from `subscriptions` table, or `null`.
- Safe to call for anonymous users — returns `null`.
- Does NOT throw. Always use null-check on the result.

### `requireActiveSubscription()`

```ts
requireActiveSubscription(): Promise<void>
```

- Redirects to `/pricing` if the user has no active subscription.
- Safe for anonymous users — they get redirected to `/pricing`.
- Use at the top of any page that requires an active subscription.

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
| `createCheckout('subscription')` | Throws `Unauthorized` |
| `getBillingPortal()` | Throws `Unauthorized` |
| `getSubscription()` | Returns `null` |
| `requireActiveSubscription()` | Redirects to `/pricing` |

**Important:** Never render `<CheckoutButton mode="subscription">` or `<BillingPortalButton>` for anonymous users without a session guard — they will throw on submit.

---

## Database tables written by this package

| Table | Written by | Key columns |
|---|---|---|
| `orders` | `checkout.session.completed` (payment) | `user_id` (nullable), `stripe_session_id`, `amount`, `status` |
| `stripe_customers` | `checkout.session.completed` (subscription) | `user_id`, `stripe_customer_id` |
| `subscriptions` | `customer.subscription.created/updated/deleted` | `user_id`, `status`, `stripe_subscription_id` |
| `webhook_events` | Every processed event | `id`, `type` (idempotency) |

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

---

## Common mistakes

- **Calling `createCheckout` or `getBillingPortal` from a client component** — these are server actions, call them via a `<form action={...}>` or from a server action wrapper.
- **Using `getUser()` on a service-role Supabase client** — it always returns null server-side. This package already handles auth correctly; don't replicate the pattern with a service-role singleton.
- **Calling `req.json()` in a webhook handler** — breaks Stripe signature verification. This package uses `req.text()` correctly.
- **Showing subscription/portal buttons to anonymous users without a guard** — they throw on submit. Check session before rendering.
- **Forgetting `STRIPE_WEBHOOK_SECRET`** — the webhook handler returns `400 Invalid signature` for every event without it.
