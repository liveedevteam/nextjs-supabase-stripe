# Skill: Setup Stripe — @liveedevteam/stripe

## Description
Fully sets up the `@liveedevteam/stripe` module in the current Next.js + Supabase project.
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

3. **Is `@liveedevteam/stripe` already installed?**
   - Check `package.json` for `@liveedevteam/stripe`
   - If not found → run `pnpm add @liveedevteam/stripe stripe @supabase/ssr` before continuing

4. **Is Stripe already set up in this project?**
   - Check if `app/api/webhooks/stripe/route.ts` already exists
   - Check if any migration file contains `stripe_customers`
   - If either exists → stop and warn the engineer that Stripe may already be configured. Ask if they want to continue anyway.

5. **Detect project type**
   - Check if `supabase/migrations/` directory exists → **existing Supabase project**
   - If not → **new project**, will need to run `supabase init` first

---

## Step 1 — Install Dependencies

If `stripe`, `@liveedevteam/stripe`, or `@supabase/ssr` are missing from `package.json`, install them:

```bash
pnpm add @liveedevteam/stripe stripe @supabase/ssr
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
  cancel_at timestamptz,
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

create table webhook_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);

-- Row Level Security
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

### Apply migration to production

```bash
supabase db push
```

If `supabase db push` fails, report the error clearly and stop. Do not continue if the schema is not applied.

---

## Step 3 — Webhook Route

Create `app/api/webhooks/stripe/route.ts` if it does not already exist:

```ts
import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'

export const POST = createWebhookHandler()
```

---

## Step 4 — Server Actions Wrapper

**Important:** Do NOT import server actions from `@liveedevteam/stripe/actions` directly inside
`'use client'` components and wrap them in arrow functions — this breaks Next.js server action
binding and the form will silently fail.

Instead, create `app/actions.ts` as a local wrapper with proper error handling:

```ts
'use server'

import {
  createCheckout as _createCheckout,
  getBillingPortal as _getBillingPortal,
  cancelSubscription as _cancelSubscription,
} from '@liveedevteam/stripe/actions'
import { redirect } from 'next/navigation'

function rethrowRedirect(e: unknown): never {
  // next/navigation redirect() throws a special error — always re-throw it
  if (
    e instanceof Error &&
    (e as any).digest?.startsWith('NEXT_REDIRECT')
  ) throw e
  throw e
}

export async function createCheckout(
  priceId: string,
  mode: 'payment' | 'subscription'
) {
  try {
    await _createCheckout(priceId, mode)
  } catch (e: any) {
    rethrowRedirect(e)
    if (e?.message === 'Unauthorized') redirect('/login')
    throw e
  }
}

export async function getBillingPortal() {
  try {
    await _getBillingPortal()
  } catch (e: any) {
    rethrowRedirect(e)
    if (e?.message === 'Unauthorized') redirect('/login')
    throw e
  }
}

export async function cancelSubscription(immediately = false) {
  try {
    await _cancelSubscription(immediately)
  } catch (e: any) {
    rethrowRedirect(e)
    throw e
  }
}
```

This wrapper:
- Catches `Unauthorized` errors and redirects to `/login` rather than crashing
- Re-throws Next.js redirect errors so they propagate correctly
- Provides a single place to add logging or error tracking later

---

## Step 5 — Checkout Button Component

Create `components/CheckoutButton.tsx`. This must be a **server component** (no `'use client'`)
that uses `.bind()` to pass the price ID as a bound server action argument:

```tsx
import { createCheckout } from '@/app/actions'

interface CheckoutButtonProps {
  priceId: string
  mode: 'payment' | 'subscription'
  label?: string
  className?: string
}

export const CheckoutButton = ({
  priceId,
  mode,
  label = 'Checkout',
  className,
}: CheckoutButtonProps) => (
  <form action={createCheckout.bind(null, priceId, mode)}>
    <button type="submit" className={className}>
      {label}
    </button>
  </form>
)
```

**Why `.bind()` and not `() => createCheckout(...)`?**
Wrapping a server action in an inline arrow function inside a `'use client'` component loses the
server action reference — React can't register it and the form silently does nothing. Using
`.bind()` on a server component creates a proper bound server action that Next.js can serialize.

---

## Step 6 — Billing Portal Button Component

Create `components/BillingPortalButton.tsx`:

```tsx
import { getBillingPortal } from '@/app/actions'

export const BillingPortalButton = ({ className }: { className?: string }) => (
  <form action={getBillingPortal}>
    <button type="submit" className={className}>
      Manage Subscription
    </button>
  </form>
)
```

---

## Step 7 — Environment Variables

Read the current `.env.local`. If it does not exist, create it.

Add any of the following that are missing — use placeholder values:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME

# Must be the full production URL with no trailing slash, e.g. https://yourapp.vercel.app
# Used as the base for Stripe success_url and cancel_url — an invalid URL will cause checkout to fail
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Do NOT overwrite any values that already exist.

After writing, clearly list which env vars were added and remind the engineer to replace placeholder values before testing.

### ⚠️ Vercel env var warning

When adding env vars to Vercel via the CLI, always use `printf` (not `echo`) to avoid a trailing
newline being stored as part of the value. A newline in `STRIPE_SECRET_KEY` causes
`Invalid character in header` errors; a newline in `NEXT_PUBLIC_APP_URL` makes Stripe reject
`success_url` with `url_invalid`.

**Correct:**
```bash
printf "sk_test_..." | vercel env add STRIPE_SECRET_KEY production
```

**Wrong — adds a trailing newline:**
```bash
echo "sk_test_..." | vercel env add STRIPE_SECRET_KEY production
```

---

## Step 8 — Slack Notifications (Optional)

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
   import { createWebhookHandler } from '@liveedevteam/stripe/webhooks'

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

## Step 9 — Backfill Check (Existing Projects Only)

If this is an **existing project** (had `supabase/migrations/` before this skill ran):

1. Check `package.json` — if the project has been running for a while, existing users may have no `stripe_customer_id`
2. Warn the engineer with this exact message:

```
⚠️  Backfill required for existing users

This project has existing auth users who do not have a Stripe customer ID.
Before going live, run the backfill script:

  node node_modules/@liveedevteam/stripe/dist/scripts/backfill.js

Always run this against staging first. Never run directly on production without testing.
```

---

## Step 10 — Verify Setup

After all steps, verify the following files exist:

- [ ] `supabase/migrations/<timestamp>_create_stripe_tables.sql`
- [ ] `app/api/webhooks/stripe/route.ts`
- [ ] `app/actions.ts` (local server action wrapper)
- [ ] `components/CheckoutButton.tsx`
- [ ] `components/BillingPortalButton.tsx`
- [ ] `.env.local` contains all 4 required Stripe env vars
- [ ] (If Slack enabled) `.env.local` contains `SLACK_WEBHOOK_URL`

If any are missing, create them now before showing the summary.

---

## Step 11 — Final Summary

Print a clear summary when done:

```
✅ Stripe setup complete

Files created:
  supabase/migrations/<timestamp>_create_stripe_tables.sql
  app/api/webhooks/stripe/route.ts
  app/actions.ts
  components/CheckoutButton.tsx
  components/BillingPortalButton.tsx

Env vars added to .env.local:
  STRIPE_SECRET_KEY (replace with real value)
  STRIPE_WEBHOOK_SECRET (replace with real value)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (replace with real value)
  NEXT_PUBLIC_APP_URL (set to http://localhost:3000 — update to your production URL before deploying)

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

  6. Before deploying to Vercel, update NEXT_PUBLIC_APP_URL to your production URL.
     When setting env vars via Vercel CLI, use printf not echo to avoid trailing newlines.
```

---

## Error Handling Rules

- If any step fails, stop immediately and report the exact error
- Never silently skip a failed step
- If `supabase db push` fails, the engineer must fix it before continuing — do not proceed without a working schema
- If env vars are missing and cannot be added (e.g. `.env.local` is gitignored with no write access), warn clearly and show the values to add manually
- If the project uses `npm` or `yarn` instead of `pnpm`, use the correct package manager detected from `package-lock.json` or `yarn.lock`

---

## Known Pitfalls (from real-world usage)

| Symptom | Root cause | Fix |
|---|---|---|
| Form does nothing when submitted | `'use client'` component wraps server action in `() => fn()` arrow — not a valid server action reference | Use `.bind()` on a server component or `app/actions.ts` wrapper |
| `Invalid character in header ["Authorization"]` | `STRIPE_SECRET_KEY` has a trailing newline from `echo \| vercel env add` | Re-add with `printf` |
| Stripe rejects `success_url` with `url_invalid` | `NEXT_PUBLIC_APP_URL` has trailing `\n` or wrong value | Re-add with `printf`, verify no trailing slash or newline |
| `Unauthorized` error on checkout click | User not logged in; package throws instead of redirecting | `app/actions.ts` wrapper catches this and redirects to `/login` |
| `Module not found: @liveedevteam/stripe` on Vercel | Demo uses `"file:.."` local path; Vercel only uploads the subdirectory | Change to published npm version `"^x.x.x"` in `package.json` |
| `NEXT_REDIRECT` swallowed / no navigation | `try/catch` catches Next.js redirect error without re-throwing | Always check `e.digest?.startsWith('NEXT_REDIRECT')` and re-throw |
