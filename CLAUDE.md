# Stripe Module — Claude Code Handover

## Quick Setup

New to this project? Run the setup skill in Claude Code:

```
set up stripe
```

Claude will detect your project type and handle everything automatically.
See `SKILL.md` for full details on what the skill does.

---

## Project Overview

This is the `@company/stripe` internal npm package — a reusable Stripe integration module for all company projects running the following tech stack:

- **Next.js** (App Router)
- **Next.js Server Actions**
- **Supabase** (Auth + Postgres)

The module handles both **one-time payments** and **subscriptions** via Stripe Checkout.

---

## Package Structure

```
@company/stripe/
├── src/
│   ├── client.ts               # Stripe singleton
│   ├── actions/
│   │   └── stripe.ts           # Next.js Server Actions
│   ├── webhooks/
│   │   ├── handler.ts          # Webhook entry point
│   │   ├── notifier.ts         # Optional Slack failure notifications
│   │   └── events/
│   │       ├── index.ts        # Event router
│   │       ├── checkout.ts
│   │       ├── subscription.ts
│   │       ├── invoice.ts
│   │       └── payment.ts
│   └── scripts/
│       └── backfill.ts         # Existing user backfill
```

---

## Core Components

### 1. Stripe Client (`src/client.ts`)

Singleton pattern. Never instantiate Stripe directly in consuming projects.

```ts
import Stripe from 'stripe'

let instance: Stripe | null = null

export const getStripeClient = () => {
  if (!instance) {
    instance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
      typescript: true,
    })
  }
  return instance
}
```

---

### 2. Database Schema — Supabase Migrations

Schema is managed via the Supabase CLI. Migration files live in `supabase/migrations/` and are versioned in git — reviewable in PRs and reproducible across local, staging, and production.

#### Setup (first time only)

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Init inside your project (if not already)
supabase init

# Create the Stripe migration
supabase migration new create_stripe_tables
```

This creates `supabase/migrations/<timestamp>_create_stripe_tables.sql`. Paste the following SQL into it:

```sql
create table stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  stripe_customer_id text unique not null,
  created_at timestamptz default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  stripe_subscription_id text unique not null,
  stripe_price_id text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id), -- nullable: anonymous one-time payments have no user
  stripe_session_id text unique not null,
  amount integer not null,
  currency text not null,
  status text not null,
  created_at timestamptz default now()
);

create table products (
  id text primary key,
  name text not null,
  description text,
  active boolean default true
);

create table prices (
  id text primary key,
  product_id text references products(id) not null,
  unit_amount integer,
  currency text not null,
  interval text,
  active boolean default true
);

create table webhook_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);
```

#### Apply migrations

```bash
# Apply to local
supabase db reset

# Apply to production
supabase db push
```

---

### 3. Server Actions (`src/actions/stripe.ts`)

| Action | Auth required | Description |
|---|---|---|
| `createCheckout` | Only for `subscription` mode | Unified checkout — anonymous allowed for `payment` |
| `getBillingPortal` | Yes | Open Stripe billing portal |
| `getSubscription` | No (returns `null`) | Current user subscription status |
| `requireActiveSubscription` | No (redirects to `/pricing`) | Guard helper for protected pages |

**Auth approach:** Server actions use `@supabase/ssr` `createServerClient` with `cookies()` to read the user's session from the request. Never use a service-role singleton for user identity — it has no session context and always returns null.

```ts
'use server'

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getStripeClient } from '../client'

// Reads the logged-in user from the request cookie session
const getAuthClient = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Service role client for DB writes that bypass RLS (webhooks, portal lookup)
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function createCheckout(priceId: string, mode: 'payment' | 'subscription') {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (mode === 'subscription' && !user) throw new Error('Unauthorized')

  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.create({
    mode,
    ...(user && { customer_email: user.email }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/cancel`,
    ...(user && { metadata: { user_id: user.id } }),
  })
  redirect(session.url!)
}

export async function getBillingPortal() {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: customer } = await serviceClient
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!customer) throw new Error('No Stripe customer found for this user')

  const stripe = getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  })
  redirect(session.url!)
}

export async function getSubscription() {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await serviceClient
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return data
}

export async function requireActiveSubscription() {
  const subscription = await getSubscription()
  if (!subscription || subscription.status !== 'active') {
    redirect('/pricing')
  }
}
```

---

### 4. Slack Notifier (`src/webhooks/notifier.ts`) — Optional

Sends a Slack message when a webhook event fails. Uses Slack Incoming Webhooks — no SDK required.

Enabled by passing `slack` config into `createWebhookHandler`. If omitted, notifications are silently skipped.

```ts
interface SlackConfig {
  webhookUrl: string  // Slack Incoming Webhook URL
  channel?: string    // e.g. '#payments-alerts' (optional, uses webhook default if omitted)
}

export const notifySlack = async (
  config: SlackConfig,
  event: { id: string; type: string },
  error: unknown
) => {
  const message = {
    channel: config.channel,
    text: `🚨 *Stripe Webhook Failed*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *Stripe Webhook Failed*\n*Event:* \`${event.type}\`\n*Event ID:* \`${event.id}\`\n*Error:* ${error instanceof Error ? error.message : String(error)}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} at {time}|${new Date().toISOString()}>` }],
      },
    ],
  }

  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
}
```

---

### 5. Webhook Handler (`src/webhooks/handler.ts`)

**Critical implementation notes:**
- Always use `req.text()` — never `req.json()` — for signature verification
- Check `webhook_events` table before processing (idempotency)
- Insert to `webhook_events` after processing
- `slack` config is optional — omit it to disable notifications

```ts
import { createClient } from '@supabase/supabase-js'
import { getStripeClient } from '../client'
import { handleEvent } from './events'
import { notifySlack } from './notifier'

interface WebhookHandlerOptions {
  slack?: {
    webhookUrl: string
    channel?: string
  }
}

export const createWebhookHandler = (options: WebhookHandlerOptions = {}) =>
  async (req: Request): Promise<Response> => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const stripe = getStripeClient()
    const sig = req.headers.get('stripe-signature')!
    const body = await req.text()

    let event
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
    } catch {
      return new Response('Invalid signature', { status: 400 })
    }

    // Idempotency check
    const { data: existing } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('id', event.id)
      .single()

    if (existing) return new Response('Already processed', { status: 200 })

    try {
      await handleEvent(event, supabase)
    } catch (error) {
      // Notify Slack if configured
      if (options.slack?.webhookUrl) {
        await notifySlack(options.slack, event, error)
      }
      return new Response('Internal error', { status: 500 })
    }

    await supabase
      .from('webhook_events')
      .insert({ id: event.id, type: event.type })

    return new Response('OK', { status: 200 })
  }
```

Mount in your project:

```ts
// app/api/webhooks/stripe/route.ts
import { createWebhookHandler } from '@company/stripe/webhooks'

// Without Slack (default)
export const POST = createWebhookHandler()

// With Slack notifications (optional)
export const POST = createWebhookHandler({
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    channel: '#payments-alerts',
  },
})
```

---

### 6. Webhook Events Handled

| Event | Action |
|---|---|
| `checkout.session.completed` | Write to `orders` or link subscription |
| `customer.subscription.updated` | Sync status to `subscriptions` |
| `customer.subscription.created` | Insert to `subscriptions` |
| `customer.subscription.deleted` | Mark subscription canceled |
| `invoice.payment_failed` | Notify user, trigger dunning |
| `invoice.paid` | Record payment history |
| `customer.subscription.trial_will_end` | Send trial expiry warning |
| `payment_intent.succeeded` | Confirm one-time payment |

```ts
// src/webhooks/events/index.ts
export const handleEvent = async (event: Stripe.Event, supabase: SupabaseClient) => {
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase)
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
      return onSubscriptionUpdated(event.data.object as Stripe.Subscription, supabase)
    case 'customer.subscription.deleted':
      return onSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase)
    case 'invoice.payment_failed':
      return onPaymentFailed(event.data.object as Stripe.Invoice, supabase)
    case 'invoice.paid':
      return onInvoicePaid(event.data.object as Stripe.Invoice, supabase)
    case 'customer.subscription.trial_will_end':
      return onTrialWillEnd(event.data.object as Stripe.Subscription, supabase)
    case 'payment_intent.succeeded':
      return onPaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, supabase)
  }
}
```

---

### 7. Backfill Script (`src/scripts/backfill.ts`)

Run once for projects that go live before Stripe is integrated.
Creates a Stripe customer for every existing auth user.

```bash
npx ts-node src/scripts/backfill.ts
```

- Safe to re-run — skips users who already have a `stripe_customer_id`
- 200ms delay per user to respect Stripe rate limits
- Always test in staging first

```ts
export const backfillStripeCustomers = async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const stripe = getStripeClient()

  const { data: users } = await supabase.auth.admin.listUsers()

  for (const user of users.users) {
    const { data: existing } = await supabase
      .from('stripe_customers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (existing) continue // skip already migrated

    const customer = await stripe.customers.create({ email: user.email! })

    await supabase.from('stripe_customers').insert({
      user_id: user.id,
      stripe_customer_id: customer.id,
    })

    await new Promise(r => setTimeout(r, 200)) // rate limit safe
  }
}
```

---

## Frontend Usage

### Checkout Button

```tsx
// components/CheckoutButton.tsx
'use client'
import { createCheckout } from '@company/stripe/actions'

export const CheckoutButton = ({ priceId, mode }: {
  priceId: string
  mode: 'payment' | 'subscription'
}) => (
  <form action={() => createCheckout(priceId, mode)}>
    <button type="submit">Checkout</button>
  </form>
)
```

### Billing Portal Button

```tsx
'use client'
import { getBillingPortal } from '@company/stripe/actions'

export const BillingPortalButton = () => (
  <form action={getBillingPortal}>
    <button type="submit">Manage Subscription</button>
  </form>
)
```

### Guard a Server Component

```ts
// app/dashboard/page.tsx
import { requireActiveSubscription } from '@company/stripe/actions'

export default async function DashboardPage() {
  await requireActiveSubscription() // redirects to /pricing if not active
  return <div>...</div>
}
```

---

## Environment Variables

```bash
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Optional — Slack notifications on webhook failure
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/xxx/xxx
```

---

## Implementation Checklist — New Project

- [ ] `pnpm add @company/stripe stripe @supabase/ssr`
- [ ] Add env vars
- [ ] `supabase init` (if not already)
- [ ] `supabase migration new create_stripe_tables` — paste SQL, then `supabase db push`
- [ ] Create `app/api/webhooks/stripe/route.ts`
- [ ] Use Server Actions from `@company/stripe/actions` in components
- [ ] Test: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- [ ] (Optional) Add `SLACK_WEBHOOK_URL` env var and pass `slack` config to `createWebhookHandler`

## Implementation Checklist — Existing Project (No Stripe yet)

- [ ] All of the above
- [ ] Run backfill script: `npx ts-node src/scripts/backfill.ts` (staging first)
- [ ] Verify all existing users have a `stripe_customer_id` before going live



---

## Event Flow

```
User clicks Checkout
  → createCheckout Server Action
  → Stripe returns checkout URL
  → User redirected to Stripe hosted page
  → User completes payment
  → Stripe POST /api/webhooks/stripe
  → Verify signature (req.text() — not req.json())
  → Idempotency check against webhook_events table
  → Event processor writes to DB via Supabase client
  → User redirected to /success
  → getSubscription() reflects new status
```

---

## Anonymous User Behaviour

| Function | Anonymous result |
|---|---|
| `createCheckout('payment')` | Allowed — proceeds to Stripe without pre-filling email or linking order to a user |
| `createCheckout('subscription')` | Throws `Unauthorized` — subscriptions require a logged-in user |
| `getBillingPortal()` | Throws `Unauthorized` |
| `getSubscription()` | Returns `null` — safe to call on any page |
| `requireActiveSubscription()` | Redirects to `/pricing` — safe to use as a page guard |

Anonymous one-time payment orders are recorded in `orders` with `user_id = null`. If you need to reconcile these orders to a user later (e.g. after sign-up), query by `stripe_session_id`.

---

## Common Mistakes to Avoid

1. **Not wrapping `handleEvent` in try/catch** — without it, a failed event returns 500 silently and Stripe keeps retrying. The try/catch is what enables Slack notifications and clean error responses.
2. **Using `req.json()` in webhook handler** — breaks Stripe signature verification. Always use `req.text()`.
2. **Skipping idempotency** — Stripe retries webhooks. Without the `webhook_events` check, subscriptions can activate twice.
3. **Hardcoding price IDs on the frontend** — query the `prices` table from Supabase instead.
4. **Not running backfill in staging first** — always validate backfill against a staging DB before production.
5. **Using service-role key to identify the current user** — `supabase.auth.getUser()` on a service-role client has no session and always returns null. Use `@supabase/ssr` `createServerClient` with `cookies()` in server actions. The service-role client is correct for the webhook handler and DB writes that bypass RLS.
6. **Rendering checkout/portal buttons for anonymous users without a guard** — `createCheckout('subscription')` and `getBillingPortal` throw for anonymous users. Wrap them in a session check or only render them on authenticated pages.
