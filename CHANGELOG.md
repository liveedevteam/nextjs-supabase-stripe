# Changelog

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
