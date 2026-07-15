# nextjs-supabase-stripe — Demo App

A minimal Next.js + Supabase app demonstrating the full billing flow.

**Live screens:** home → sign up → pricing → Stripe Checkout → dashboard → manage/cancel

## Running locally

```bash
cp .env.local.example .env.local
# fill in your Supabase and Stripe test keys
pnpm install
pnpm dev        # runs on http://localhost:3001
```

In a separate terminal:

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Use Stripe test card `4242 4242 4242 4242` with any future expiry and any CVC.

## What's demonstrated

| Feature | Where |
|---|---|
| `createCheckout` | `/pricing` — checkout buttons |
| `requireActiveSubscription` | `/dashboard` — page guard |
| `getSubscription` | `/dashboard` — plan status display |
| `getBillingPortal` | `/dashboard` — manage billing button |
| `cancelSubscription` | `/dashboard` — cancel button |
| `createWebhookHandler` | `/api/webhooks/stripe` |

## Deploying to Vercel

```bash
vercel --cwd demo
```

Set the same env vars from `.env.local.example` in your Vercel project settings, plus set `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL.
