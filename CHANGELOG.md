# Changelog

## [0.1.6] - 2026-06-19

### Added
- `changeSubscription(newPriceId, prorationBehavior?)` server action — upgrades or downgrades the user's current subscription; retrieves the subscription item ID from Stripe and calls `subscriptions.update`; the existing `customer.subscription.updated` webhook handler writes the new price and period to the DB automatically
- `prorationBehavior` accepts `'create_prorations'` (default), `'none'`, or `'always_invoice'`

## [0.1.5] - 2026-06-19

### Added
- New `@liveedevteam/stripe/testing` export with two utilities:
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
- Fix `@company/stripe` → `@liveedevteam/stripe` throughout `SKILL.md`

### Changed
- Supabase service client is now a lazy singleton (was created at module load / per webhook request)
- `getSubscription()` now excludes terminal `canceled` and `incomplete_expired` statuses
- `getSubscription()` return type is now explicit `Promise<Subscription | null>`
- Backfill rate-limit errors (429) retry with exponential backoff up to 3 times
- Backfill now paginates through all users (was silently capped at 50)

### Added
- `cancel_at` column in subscriptions schema and written on every subscription upsert
- Row Level Security policies in migration for `stripe_customers`, `subscriptions`, and `orders`
- Export `Subscription` type from `@liveedevteam/stripe/types`
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
