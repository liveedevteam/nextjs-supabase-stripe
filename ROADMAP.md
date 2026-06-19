# @liveedevteam/stripe — Roadmap

---

## Completed

### Core billing
- [x] `createCheckout` — one-time payment and subscription modes
- [x] `getBillingPortal` — redirect to Stripe-hosted billing portal
- [x] `getSubscription` — fetch current subscription row
- [x] `requireActiveSubscription` — page guard with `/pricing` redirect
- [x] `changeSubscription` — upgrade / downgrade with proration control
- [x] `cancelSubscription` — soft cancel (end of period) or immediate

### Webhooks
- [x] `createWebhookHandler` — signature verification, idempotency via `webhook_events` table
- [x] Claim-before-process pattern — prevents duplicate processing on Stripe retries
- [x] Slack failure alerts on webhook errors
- [x] Handlers for `checkout.session.completed`, subscription lifecycle, invoice paid/failed, trial will end

### Type safety
- [x] `Database` type exported from `@liveedevteam/stripe/types`
- [x] `getServiceClient()` returns `SupabaseClient<Database>` — column names checked at compile time
- [x] `Subscription` type derived from DB schema — always in sync
- [x] Stripe v22 / dahlia API compatibility (period dates on item, invoice subscription ID via parent)

### Testing
- [x] `buildWebhookRequest` — produces a properly HMAC-signed `Request` for testing webhook routes
- [x] `stripeFixtures` — pre-built event objects in dahlia API shape
- [x] 75 unit tests across 7 files covering all handlers, router, actions, and testing utilities
- [x] CI: typecheck + build + test on every push and PR

### Infrastructure
- [x] Dual ESM + CJS build via tsup
- [x] `@liveedevteam/stripe/actions`, `/webhooks`, `/types`, `/testing` entry points
- [x] CHANGELOG, CLAUDE.md AI context, SKILL.md automated setup skill
- [x] Migration SQL with RLS policies, `cancel_at` column

---

## Up Next

### Actions
- [ ] **Free trial** — expose `trial_period_days` in `createCheckout`; subscription arrives with `status: 'trialing'`, existing webhook handler writes it
- [ ] **Promo / coupon codes** — `allow_promotion_codes: true` option in `createCheckout`; single flag, no backend logic
- [ ] **Reactivate subscription** — undo a pending `cancel_at_period_end` cancellation via `stripe.subscriptions.update({ cancel_at_period_end: false })`
- [ ] **Configurable redirect URLs** — let callers pass `successUrl` / `cancelUrl` into `createCheckout` instead of reading from env
- [ ] **Configurable login redirect** — `loginUrl` option so `createCheckout('subscription')` redirects to login instead of throwing `Unauthorized`

### Resilience
- [ ] **Stuck-claim reaper** — if a worker crashes between claim and delete, the event is silently dropped forever; add `claimed_at` timestamp and a cron or background job to re-open stale claims after N minutes
- [ ] **Webhook timeout guard** — wrap `handleEvent` in `Promise.race` against a 25s timeout so Stripe gets a retryable 500 instead of a hanging connection

### Testing
- [x] **Integration smoke tests** — 15 tests across 4 files hitting real local Supabase; covers webhook handler routing, checkout/subscription/invoice event handlers, and idempotency via real DB UNIQUE constraint; CI job runs on main pushes via `supabase start`

---

## Backlog (lower priority)

- [ ] **Multiple subscription items** — `getSubscription` and `changeSubscription` currently assume one item per subscription
- [ ] **Usage-based / metered billing** — `reportUsage(subscriptionItemId, quantity)` action wrapping `stripe.subscriptionItems.createUsageRecord`
- [ ] **Idempotent checkout** — store a short-lived `pending_checkout` token before `sessions.create` to prevent duplicate sessions on double-click
- [ ] **Per-seat pricing** — `quantity` param in `createCheckout` and `changeSubscription`
- [ ] **Tax / address collection** — pass `automatic_tax: { enabled: true }` and `billing_address_collection` options through `createCheckout`
