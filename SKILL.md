# Skill: Setup Stripe — @company/stripe

## Description
Fully sets up the `@company/stripe` module in the current Next.js + Supabase project.
Handles both new projects and existing projects that need Stripe added.

Trigger phrases:
- "set up stripe"
- "add stripe to this project"
- "implement stripe"
- "integrate stripe"
- "setup stripe module"

---

## Pre-flight Checks

Before doing anything, Claude must verify the following. Stop and report clearly if any check fails.

1. **Is this a Next.js project?**
   - Check for `next.config.ts` or `next.config.js` in the root
   - If not found → stop and tell the engineer this skill only works with Next.js projects

2. **Is Supabase set up?**
   - Check for `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` or `.env`
   - If not found → stop and tell the engineer to set up Supabase first

3. **Is `@company/stripe` already installed?**
   - Check `package.json` for `@company/stripe`
   - If not found → run `pnpm add @company/stripe stripe @supabase/ssr` before continuing

4. **Is Stripe already set up in this project?**
   - Check if `app/api/webhooks/stripe/route.ts` already exists
   - Check if any migration file contains `stripe_customers`
   - If either exists → stop and warn the engineer that Stripe may already be configured. Ask if they want to continue anyway.

5. **Detect project type**
   - Check if `supabase/migrations/` directory exists → **existing Supabase project**
   - If not → **new project**, will need to run `supabase init` first

---

## Step 1 — Install Dependencies

If `stripe`, `@company/stripe`, or `@supabase/ssr` are missing from `package.json`, install them:

```bash
pnpm add @company/stripe stripe @supabase/ssr
```

Verify installation succeeded before moving to the next step.

---

## Step 2 — Supabase Migration

### If `supabase/` directory does not exist

```bash
supabase init
```

### Create the Stripe migration

```bash
supabase migration new create_stripe_tables
```

This generates `supabase/migrations/<timestamp>_create_stripe_tables.sql`.

Write the following SQL into that file exactly:

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

### Apply migration to production

```bash
supabase db push
```

If `supabase db push` fails, report the error clearly and stop. Do not continue if the schema is not applied.

---

## Step 3 — Webhook Route

Create `app/api/webhooks/stripe/route.ts` if it does not already exist:

```ts
import { createWebhookHandler } from '@company/stripe/webhooks'

export const POST = createWebhookHandler()
```

---

## Step 4 — Checkout Button Component

Check if a checkout button component already exists anywhere in `components/`.
If not, create `components/CheckoutButton.tsx`:

```tsx
'use client'

import { createCheckout } from '@company/stripe/actions'

interface CheckoutButtonProps {
  priceId: string
  mode: 'payment' | 'subscription'
  label?: string
}

export const CheckoutButton = ({
  priceId,
  mode,
  label = 'Checkout',
}: CheckoutButtonProps) => (
  <form action={() => createCheckout(priceId, mode)}>
    <button type="submit">{label}</button>
  </form>
)
```

---

## Step 5 — Billing Portal Button Component

Create `components/BillingPortalButton.tsx` if it does not exist:

```tsx
'use client'

import { getBillingPortal } from '@company/stripe/actions'

export const BillingPortalButton = () => (
  <form action={getBillingPortal}>
    <button type="submit">Manage Subscription</button>
  </form>
)
```

---

## Step 6 — Environment Variables

Read the current `.env.local`. If it does not exist, create it.

Add any of the following that are missing — use placeholder values:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Do NOT overwrite any values that already exist.

After writing, clearly list which env vars were added and remind the engineer to replace placeholder values before testing.

---

## Step 7 — Slack Notifications (Optional)

Ask the engineer:

```
Would you like to enable Slack notifications when a webhook event fails? (yes/no)
```

### If yes

1. Ask for the Slack Incoming Webhook URL:
   ```
   Paste your Slack Incoming Webhook URL (from https://api.slack.com/apps → Incoming Webhooks):
   ```

2. Ask for the channel to post to:
   ```
   Which channel? (e.g. #payments-alerts) — press Enter to use the webhook default:
   ```

3. Add `SLACK_WEBHOOK_URL` to `.env.local`:
   ```bash
   SLACK_WEBHOOK_URL=<value engineer provided>
   ```

4. Update `app/api/webhooks/stripe/route.ts` to pass the Slack config:
   ```ts
   import { createWebhookHandler } from '@company/stripe/webhooks'

   export const POST = createWebhookHandler({
     slack: {
       webhookUrl: process.env.SLACK_WEBHOOK_URL!,
       channel: '#payments-alerts', // use value engineer provided, or omit if they pressed Enter
     },
   })
   ```

### If no

Leave `app/api/webhooks/stripe/route.ts` as:
```ts
export const POST = createWebhookHandler()
```

No further action needed. Slack can always be added later.

---

## Step 8 — Backfill Check (Existing Projects Only)

If this is an **existing project** (had `supabase/migrations/` before this skill ran):

1. Check `package.json` — if the project has been running for a while, existing users may have no `stripe_customer_id`
2. Warn the engineer with this exact message:

```
⚠️  Backfill required for existing users

This project has existing auth users who do not have a Stripe customer ID.
Before going live, run the backfill script:

  npx ts-node node_modules/@company/stripe/scripts/backfill.ts

Always run this against staging first. Never run directly on production without testing.
```

---

## Step 9 — Verify Setup

After all steps, verify the following files exist:

- [ ] `supabase/migrations/<timestamp>_create_stripe_tables.sql`
- [ ] `app/api/webhooks/stripe/route.ts`
- [ ] `components/CheckoutButton.tsx`
- [ ] `components/BillingPortalButton.tsx`
- [ ] `.env.local` contains all 4 required Stripe env vars
- [ ] (If Slack enabled) `.env.local` contains `SLACK_WEBHOOK_URL`

If any are missing, create them now before showing the summary.

---

## Step 10 — Final Summary

Print a clear summary when done:

```
✅ Stripe setup complete

Files created:
  supabase/migrations/<timestamp>_create_stripe_tables.sql
  app/api/webhooks/stripe/route.ts
  components/CheckoutButton.tsx
  components/BillingPortalButton.tsx

Env vars added to .env.local:
  STRIPE_SECRET_KEY (replace with real value)
  STRIPE_WEBHOOK_SECRET (replace with real value)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (replace with real value)
  NEXT_PUBLIC_APP_URL (set to http://localhost:3000)

Next steps:
  1. Fill in real Stripe API keys in .env.local
     → Get them from https://dashboard.stripe.com/apikeys

  2. Get your webhook secret by running:
     stripe listen --forward-to localhost:3000/api/webhooks/stripe
     → Copy the whsec_... value into STRIPE_WEBHOOK_SECRET

  3. Test a checkout (replace <user-uuid> with a real user ID from your auth.users table):
     stripe trigger checkout.session.completed \
       --override "checkout_session:metadata[user_id]=<user-uuid>"

     To test anonymous one-time payment (no user_id needed):
     stripe trigger checkout.session.completed

  4. Test a webhook failure notification (if Slack enabled):
     stripe trigger invoice.payment_failed
     → Check your Slack channel for the alert

  5. Use CheckoutButton in your pricing page:
     — Subscription (requires login):
       <CheckoutButton priceId="price_xxx" mode="subscription" />
     — One-time payment (anonymous allowed):
       <CheckoutButton priceId="price_xxx" mode="payment" />
```

---

## Error Handling Rules

- If any step fails, stop immediately and report the exact error
- Never silently skip a failed step
- If `supabase db push` fails, the engineer must fix it before continuing — do not proceed without a working schema
- If env vars are missing and cannot be added (e.g. `.env.local` is gitignored with no write access), warn clearly and show the values to add manually
- If the project uses `npm` or `yarn` instead of `pnpm`, use the correct package manager detected from `package-lock.json` or `yarn.lock`
