# @liveedevteam/stripe

Stripe integration module for **Next.js App Router + Supabase** — one-time payments, subscriptions, webhooks, and server actions.

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

## Environment variables

```bash
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Database migration

```bash
supabase migration new create_stripe_tables
```

Paste into the generated file:

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
  user_id uuid references auth.users(id), -- nullable for anonymous payments
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

```bash
supabase db push
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

const subscription = await getSubscription() // returns null for anonymous/no subscription
```

## Anonymous user support

| Action | Anonymous |
|---|---|
| `createCheckout('payment')` | Allowed — order recorded with `user_id = null` |
| `createCheckout('subscription')` | Throws `Unauthorized` |
| `getBillingPortal()` | Throws `Unauthorized` |
| `getSubscription()` | Returns `null` |
| `requireActiveSubscription()` | Redirects to `/pricing` |

## Local testing

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

## Existing users backfill

If you integrated Stripe after users already existed, create a Stripe customer for each:

```bash
node node_modules/@liveedevteam/stripe/dist/scripts/backfill.js
```

Always run against staging first.

## License

MIT
