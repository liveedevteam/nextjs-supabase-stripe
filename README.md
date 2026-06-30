# @liveedevteam/stripe

Stripe integration module for **Next.js App Router + Supabase** — one-time payments, subscriptions, webhooks, and server actions.

[![npm version](https://img.shields.io/npm/v/@liveedevteam/stripe)](https://www.npmjs.com/package/@liveedevteam/stripe)
[![CI](https://github.com/liveedevteam/nextjs-supabase-stripe/actions/workflows/ci.yml/badge.svg)](https://github.com/liveedevteam/nextjs-supabase-stripe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Getting started

Add Stripe payments to your Next.js + Supabase app in under 5 minutes.

### 1. Install

```bash
pnpm add @liveedevteam/stripe stripe @supabase/ssr
```

### 2. Add env vars

```bash
# .env.local
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### 3. Run the database migration

```bash
supabase migration new create_stripe_tables
supabase db push
```

<details>
<summary>SQL to paste into the migration file</summary>

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
  cancel_at timestamptz,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  stripe_session_id text unique not null,
  amount integer not null,
  currency text not null,
  status text not null,
  created_at timestamptz default now()
);

create table webhook_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);

alter table stripe_customers enable row level security;
alter table subscriptions enable row level security;
alter table orders enable row level security;
alter table webhook_events enable row level security;

create policy "users_read_own_stripe_customer" on stripe_customers
  for select to authenticated using (auth.uid() = user_id);

create policy "users_read_own_subscriptions" on subscriptions
  for select to authenticated using (auth.uid() = user_id);

create policy "users_read_own_orders" on orders
  for select to authenticated using (auth.uid() = user_id);
```

</details>

### 4. Mount the webhook route

```ts
// app/api/webhooks/stripe/route.ts
import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'

export const POST = createWebhookHandler()
```

### 5. Add a checkout button

```tsx
// components/checkout-button.tsx
'use client'
import { createCheckout } from '@liveedevteam/stripe/actions'

export const CheckoutButton = ({ priceId }: { priceId: string }) => (
  <form action={() => createCheckout(priceId, 'subscription')}>
    <button type="submit">Subscribe</button>
  </form>
)
```

### 6. Test it locally

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

That's it. Payments, webhooks, and database sync are all wired up.

> **Using Claude Code?** Skip all of the above — just type `set up stripe` and Claude handles every step automatically. [See the Claude Code skill ↓](#claude-code-setup-skill)

---

## Demo app

A working demo lives in [`/demo`](./demo) — a minimal Next.js + Supabase SaaS with a pricing page, Stripe Checkout, a protected dashboard, and subscription management.

**The entire demo was built using this package and Claude Code.** Here's exactly how:

### Setup — `set up stripe`

After scaffolding a blank Next.js + Supabase project, the Claude Code skill that ships inside this package was invoked with a single command:

```
set up stripe
```

Claude ran preflight checks, created the Supabase migration, wrote the webhook route, and added all required env vars to `.env.local` — no copy-pasting required.

### Pricing page — `createCheckout`

Each plan card has a checkout button that calls `createCheckout` as a server action. Clicking it redirects directly to Stripe Checkout with the correct price ID and user metadata attached:

```tsx
// demo/app/pricing/checkout-button.tsx
'use client'
import { createCheckout } from '@liveedevteam/stripe/actions'

export default function CheckoutButton({ priceId }: { priceId: string }) {
  return (
    <form action={() => createCheckout(priceId, 'subscription')}>
      <button type="submit">Get started</button>
    </form>
  )
}
```

### Dashboard — `requireActiveSubscription` + `getSubscription`

The dashboard is a server component. Two lines handle auth and data — no middleware, no custom guards:

```ts
// demo/app/dashboard/page.tsx
await requireActiveSubscription() // redirects to /pricing if no active sub
const sub = await getSubscription() // typed subscription row from DB
```

The page renders the plan status, current period end, and cancel state directly from the `sub` object.

### Billing portal — `getBillingPortal`

A single server action wires up the "Manage billing" button. Stripe handles the rest:

```tsx
// demo/app/dashboard/portal-button.tsx
import { getBillingPortal } from '@liveedevteam/stripe/actions'

export default function PortalButton() {
  return (
    <form action={getBillingPortal}>
      <button type="submit">Manage billing</button>
    </form>
  )
}
```

### Cancel — `cancelSubscription`

The cancel button calls `cancelSubscription()` which sets `cancel_at_period_end: true` on the Stripe subscription. The DB is updated automatically when Stripe fires `customer.subscription.updated` — no extra code needed:

```ts
import { cancelSubscription } from '@liveedevteam/stripe/actions'
await cancelSubscription() // soft cancel — access until period end
```

### Webhooks — `createWebhookHandler`

The webhook route is one line. Signature verification, idempotency, and all event handlers are built in:

```ts
// demo/app/api/webhooks/stripe/route.ts
import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'
export const POST = createWebhookHandler()
```

### Result

The complete demo — 7 routes, auth, checkout, dashboard, and webhooks — was built in a single session with Claude Code. The package handled every Stripe interaction; the demo only needed to build the UI around it.

→ **[View the demo source](./demo)**

---

## Claude Code setup skill

This package ships a **Claude Code skill** that automates the full integration — migration, webhook route, env vars, and more. No copy-pasting required.

### How to use it

After installing the package, open [Claude Code](https://claude.ai/code) in your project and type:

```
set up stripe
```

Claude detects what's already in place and walks through every step automatically.

**What the skill does:**

1. Checks for missing dependencies and installs them
2. Creates the Supabase migration (`stripe_customers`, `subscriptions`, `orders`, `products`, `prices`, `webhook_events`) and applies it
3. Creates `app/api/webhooks/stripe/route.ts` with signature verification and idempotency
4. Scaffolds a `CheckoutButton` component (and billing portal button if subscriptions are enabled)
5. Adds all required env vars to `.env.local` (with placeholder values to fill in)
6. Optionally configures Slack failure notifications
7. Warns you to run the backfill script if existing users are present

The skill file (`SKILL.md`) ships inside the package — Claude Code reads it automatically from `node_modules/@liveedevteam/stripe/SKILL.md`. You get updated instructions with every version you install.

### Example session

```
You: set up stripe

Claude: Running preflight checks...
  ✓ @liveedevteam/stripe installed
  ✓ stripe installed
  ✓ @supabase/ssr installed
  ✗ Supabase migration not found

  Creating migration...
  Writing supabase/migrations/20260101000000_create_stripe_tables.sql
  Running: supabase db push

  Creating webhook route...
  Writing app/api/webhooks/stripe/route.ts

  Adding env vars to .env.local...
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

  Done. Next steps:
  1. Fill in the placeholder values in .env.local
  2. Run: stripe listen --forward-to localhost:3000/api/webhooks/stripe
  3. Test: stripe trigger checkout.session.completed
```

---

## Requirements

- Next.js 14+
- Supabase (Auth + Postgres)
- Node.js 18+

## Installation

```bash
pnpm add @liveedevteam/stripe stripe @supabase/ssr
```

## Webhook route

```ts
// app/api/webhooks/stripe/route.ts
import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'

export const POST = createWebhookHandler()
```

With optional Slack notifications on failure:

```ts
export const POST = createWebhookHandler({
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    channel: '#payments-alerts',
  },
})
```

## Server actions

### Checkout button

```tsx
'use client'
import { createCheckout } from '@liveedevteam/stripe/actions'

export const CheckoutButton = ({ priceId, mode }: {
  priceId: string
  mode: 'payment' | 'subscription'
}) => (
  <form action={() => createCheckout(priceId, mode)}>
    <button type="submit">Checkout</button>
  </form>
)
```

### Billing portal

```tsx
'use client'
import { getBillingPortal } from '@liveedevteam/stripe/actions'

export const BillingPortalButton = () => (
  <form action={getBillingPortal}>
    <button type="submit">Manage Subscription</button>
  </form>
)
```

### Guard a page

```ts
import { requireActiveSubscription } from '@liveedevteam/stripe/actions'

export default async function DashboardPage() {
  await requireActiveSubscription() // redirects to /pricing if not active
  return <div>...</div>
}
```

### Check subscription status

```ts
import { getSubscription } from '@liveedevteam/stripe/actions'

const subscription = await getSubscription() // null for anonymous or no subscription
if (subscription?.status === 'active' || subscription?.status === 'trialing') {
  // has access
}
```

### Cancel a subscription

```ts
import { cancelSubscription } from '@liveedevteam/stripe/actions'

// Cancel at period end (default) — user keeps access until billing period ends
await cancelSubscription()

// Cancel immediately
await cancelSubscription(true)
```

The DB is updated automatically via `customer.subscription.updated` / `customer.subscription.deleted` webhooks.

### Upgrade or downgrade

```ts
import { changeSubscription } from '@liveedevteam/stripe/actions'

await changeSubscription('price_new_plan_id')

// Control proration
await changeSubscription('price_new_plan_id', 'none')           // no proration
await changeSubscription('price_new_plan_id', 'always_invoice') // invoice immediately
```

The DB is updated automatically via `customer.subscription.updated` webhook.

## TypeScript types

```ts
import type { Subscription, Database } from '@liveedevteam/stripe/types'
```

`Subscription` is derived directly from the `Database` schema so it stays in sync with your table.

## Anonymous user support

| Action | Anonymous |
|---|---|
| `createCheckout('payment')` | Allowed — order recorded with `user_id = null` |
| `createCheckout('subscription')` | Throws `Unauthorized` |
| `getBillingPortal()` | Throws `Unauthorized` |
| `getSubscription()` | Returns `null` |
| `requireActiveSubscription()` | Redirects to `/pricing` |
| `cancelSubscription()` | Throws `Unauthorized` |
| `changeSubscription(priceId)` | Throws `Unauthorized` |

## Testing

```ts
import { buildWebhookRequest, stripeFixtures } from '@liveedevteam/stripe/testing'
```

Build a signed webhook request to pass directly to your route handler in tests:

```ts
const req = buildWebhookRequest(
  'checkout.session.completed',
  stripeFixtures.checkoutSessionCompleted({ mode: 'subscription', userId: 'user-1' }),
  { secret: process.env.STRIPE_WEBHOOK_SECRET! }
)
const res = await POST(req)
expect(res.status).toBe(200)
```

Available fixtures: `checkoutSessionCompleted`, `subscription`, `invoice`. All are shaped for Stripe API version `2026-05-27.dahlia`.

## Existing users backfill

If users already had Stripe subscriptions before you installed this package, sync them into the `stripe_customers` table:

```bash
node node_modules/@liveedevteam/stripe/dist/scripts/backfill.js
```

The script looks up each user by email in Stripe and records the match — it **does not create new Stripe customers**. Always run against staging first.

## License

MIT
