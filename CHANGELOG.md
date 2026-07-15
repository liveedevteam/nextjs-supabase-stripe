# Changelog

## [0.2.0] - 2026-07-15

### Changed
- Renamed package from `@liveedevteam/stripe` to `nextjs-supabase-stripe`. The old scoped package is deprecated on npm; install the new name going forward.

## [0.1.8] - 2026-06-19

### Added
- Integration test suite (15 tests, 4 files) against real local Supabase — no mocks for DB or crypto:
  - `webhook.test.ts` — handler routing: valid signature, invalid signature, claim deletion on handler failure
  - `checkout.test.ts` — `orders` and `stripe_customers` writes: anonymous payment, authenticated payment, subscription upsert, double-checkout idempotency
  - `subscription.test.ts` — full lifecycle: created, dahlia regression (period dates from `items.data[0]`), updated, deleted, `invoice.paid`, `invoice.payment_failed`; no-op guard pattern on all update tests
  - `idempotency.test.ts` — same event ID blocked by real DB `UNIQUE` constraint; two event IDs for same subscription (last write wins)
- `tests/integration/schema.sql` — canonical test DB schema with `ON DELETE CASCADE` for safe per-test cleanup via `auth.admin.deleteUser`
- `supabase/config.toml` — minimal local Supabase config (studio/inbucket/storage/analytics disabled)
- CI `integration` job — runs on main pushes only; starts local Supabase, applies test schema, runs `pnpm test:integration`

### Changed
- `vitest.config.ts` scoped to `src/**/*.test.ts` so integration tests don't appear as skipped in `pnpm test`

## [0.1.7] - 2026-06-19

### Added
- `cancelSubscription(immediately?)` server action — soft cancel (default, sets `cancel_at_period_end: true`) or immediate cancel (`stripe.subscriptions.cancel`); DB updated via existing webhook handlers in both cases
- `Database` type exported from `nextjs-supabase-stripe/types` — covers `Row`, `Insert`, `Update` for all four package-owned tables; consumers can merge it with their own generated types

### Changed
- `Subscription` type is now derived from `Database['public']['Tables']['subscriptions']['Row']` so it stays in sync with the schema automatically
- `getServiceClient()` now returns `SupabaseClient<Database>` — all `.from()` calls inside the package are type-checked against the schema at compile time
- All event handlers updated to accept `SupabaseClient<Database>`, catching column-name typos at compile time

## [0.1.6] - 2026-06-19

### Added
- `changeSubscription(newPriceId, prorationBehavior?)` server action — upgrades or downgrades the user's current subscription; retrieves the subscription item ID from Stripe and calls `subscriptions.update`; the existing `customer.subscription.updated` webhook handler writes the new price and period to the DB automatically
- `prorationBehavior` accepts `'create_prorations'` (default), `'none'`, or `'always_invoice'`

## [0.1.5] - 2026-06-19

### Added
- New `nextjs-supabase-stripe/testing` export with two utilities:
  - `buildWebhookRequest(eventType, object, options)` — builds a properly HMAC-signed `Request` that passes Stripe's `constructEvent` verification; pass it directly to your `POST` route handler in tests
  - `stripeFixtures` — pre-built event objects in the 2026-05-27.dahlia API shape (period dates on `items.data[0]`, invoice subscription at `parent.subscription_details.subscription`)

## [0.1.4] - 2026-06-19

### Fixed
- Slack failure can no longer mask the 500 response to Stripe — `notifySlack` is now fire-and-forget so a Slack outage does not prevent Stripe from retrying the webhook

### Added
- Full test suite: 53 tests across 6 files covering all webhook event handlers, event router, webhook handler, and server actions
- CI now runs `pnpm test` in addition to typecheck and build

## [0.1.3] - 2026-06-19

### Fixed
- All Supabase writes now check the returned error and throw — DB failures propagate to Stripe for retry
- Guard against undefined subscription item before reading `current_period_start/end` (dahlia API)
- Invoice handlers updated for dahlia API: subscription ID now at `parent.subscription_details.subscription`
- Subscription checkout with no `user_id` in metadata now throws instead of silently skipping
- Fix `@company/stripe` → `nextjs-supabase-stripe` throughout `SKILL.md`

### Changed
- Supabase service client is now a lazy singleton (was created at module load / per webhook request)
- `getSubscription()` now excludes terminal `canceled` and `incomplete_expired` statuses
- `getSubscription()` return type is now explicit `Promise<Subscription | null>`
- Backfill rate-limit errors (429) retry with exponential backoff up to 3 times
- Backfill now paginates through all users (was silently capped at 50)

### Added
- `cancel_at` column in subscriptions schema and written on every subscription upsert
- Row Level Security policies in migration for `stripe_customers`, `subscriptions`, and `orders`
- Export `Subscription` type from `nextjs-supabase-stripe/types`
- PR CI workflow: typecheck and build run on every push and pull request
- `peerDependencies` tightened to `stripe >= 22` to match the API version in use

### Removed
- `products` and `prices` tables from migration — were never written to by this package

## [0.1.2] - 2026-06-15

### Fixed
- Write npm auth token explicitly to `~/.npmrc` before publish
- Bump CI to Node 22

## [0.1.1] - 2026-06-14

### Fixed
- Repository URL in package.json

## [0.1.0] - 2026-06-14

Initial release.
