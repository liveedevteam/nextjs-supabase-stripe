# nextjs-supabase-stripe - Roadmap

This roadmap is ordered by production risk. Correct billing state, trustworthy
verification, and a single schema contract take priority over new features.

## Priority Definitions

- **P0 - Release blockers:** Can produce incorrect billing data, broken setup, or false-green CI.
- **P1 - Production hardening:** Required for resilient operation and safe maintenance at scale.
- **P2 - Developer experience:** Improves configuration, integration flexibility, and observability.
- **P3 - Product expansion:** Adds billing capabilities after the production foundation is reliable.

---

## P0 - Correctness And Release Confidence

**Status: shipped in 0.3.0** (PRs #2-#7). See CHANGELOG.md for the release notes.

### Repair the existing backfill

- [x] Query an existing `stripe_customers` column (`user_id`), not the removed `id` column.
- [x] Check and report Supabase select and insert errors instead of silently continuing.
- [x] Handle users without email addresses explicitly.
- [x] Detect ambiguous Stripe email matches and require manual review instead of selecting an arbitrary customer.
- [x] Add unit tests for existing mappings, missing users, duplicate email matches, pagination, rate limiting, and database failures.
- [x] Add a dry-run mode and a final summary of matched, skipped, failed, and ambiguous users.

**Done when:** the packaged command succeeds against the canonical schema and cannot silently lose a failed mapping.

### Make integration CI trustworthy

- [x] Fix service-role key propagation in `.github/workflows/ci.yml`; consume the value written to `GITHUB_ENV` directly.
- [x] Make integration tests fail in CI when Supabase credentials are absent or the local stack is unavailable.
- [x] Keep graceful skipping only for explicit local developer runs.
- [x] Run integration tests on every pull request (stronger than the original "only PRs touching certain paths" — this suite has no external dependency to rate-limit, so there was no reason to scope it).
- [x] Assert that the expected number of integration tests ran, so an all-skipped suite cannot pass.
- [x] Pin the Supabase CLI version used by CI instead of using `latest`.

**Done when:** CI fails if any required integration dependency is missing and reports 15 or more executed integration tests.

### Prevent incorrect payment and subscription state

- [x] Check `checkout.session.completed.payment_status` before recording a one-time order as paid.
- [x] Support `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.
- [x] Define order states for pending, paid, and failed payments.
- [x] Normalize Stripe IDs when `customer`, `subscription`, or related fields are expanded objects.
- [x] Reject malformed events instead of writing empty price IDs or asserting nullable amounts and currencies.
- [x] Prevent late invoice events from reactivating canceled subscriptions.
- [x] Prevent older subscription events from overwriting newer state.
- [x] Prefer synchronization from Stripe's authoritative current subscription state for lifecycle events.
- [x] Add tests for delayed payments, expanded objects, malformed payloads, duplicate events, and out-of-order delivery.

**Done when:** webhook delivery order cannot regress terminal subscription state or mark an unpaid order as paid.

### Establish one canonical database contract

- [x] Treat `supabase/migrations/` as the only schema source of truth.
- [x] Make `SKILL.md`, `README.md`, `DEVELOPMENT.md`, and integration setup match the canonical migration.
- [x] Remove obsolete `products`, `prices`, `processed_at`, and alternate `stripe_customers.id` examples.
- [x] Generate `Database` types from the canonical schema or verify them automatically in CI.
- [x] Correct TypeScript nullability for period dates, timestamps, and defaults.
- [x] Ship the canonical migration in the npm package so consumers do not depend on copied documentation SQL.
- [x] Add an automated schema-equivalence or migration smoke test.

**Done when:** a clean consumer installation, local integration schema, documentation, and exported types all describe the same tables and columns.

### Propagate configuration and database failures

- [x] Validate all required environment variables before constructing Stripe or Supabase clients.
- [x] Produce actionable messages for missing keys, URLs, and webhook secrets.
- [x] Check Supabase errors separately from valid empty results in every action and webhook handler.
- [x] Prevent database outages from appearing as "no subscription" or "no customer".
- [x] Replace generic message matching with exported typed errors such as `UnauthorizedError` and `CustomerNotFoundError`.
- [x] Validate Stripe redirect URLs before creating Checkout or Portal sessions.

**Done when:** invalid configuration and dependency failures fail explicitly and are covered by tests.

### Strengthen release verification

- [x] Run typecheck, unit tests, integration tests, build, package dry-run, and demo build before publishing.
- [x] Verify the git tag and `package.json` version match.
- [x] Test importing every public ESM and CJS export from the packed tarball.
- [x] Add a package-content assertion for migrations, documentation, declarations, and runtime entry points.

**Done when:** the release workflow cannot publish an untested or incomplete package.

**Known gap:** the tag-triggered release workflow's `npm publish --provenance` step (OIDC trusted publishing)
fails with a registry-side 404 on every attempt, despite provenance signing succeeding and all Trusted
Publisher fields on npmjs.com matching. Every other gate step (typecheck, tests, integration, build,
tarball content assertion, import smoke test, demo build) passes reliably. 0.3.0 was published via a
one-time manual `npm publish` as a workaround. The OIDC path is unverified end-to-end and needs further
investigation before the next release can rely on it.

---

## P1 - Production Hardening

### Durable webhook processing

- [ ] Replace claim-row existence with explicit `processing`, `completed`, and `failed` states.
- [ ] Store `claimed_at`, `completed_at`, attempt count, Stripe event creation time, and the last error summary.
- [ ] Reclaim stale `processing` events after a configurable timeout.
- [ ] Make claim and state transitions atomic with a database function or equivalent transaction boundary.
- [ ] Add a webhook processing timeout that returns a retryable response before the platform request limit.
- [ ] Test concurrent delivery, crash recovery, stale claims, retry exhaustion, and partial database failures.

### Database safety and performance

- [ ] Replace broad `grant all` permissions for `anon` and `authenticated` with explicit required privileges.
- [ ] Use the authenticated Supabase client for user-owned reads so RLS remains the authorization boundary.
- [ ] Reserve the service-role client for webhook processing and administrative operations.
- [ ] Add constraints for subscription status, order status, currency format, and nonnegative amounts.
- [ ] Add indexes for subscription lookups by `user_id`, status, and `current_period_end`.
- [ ] Decide and enforce whether one user may have multiple concurrent subscriptions.
- [ ] Run Supabase database advisors as part of migration review.

### Broaden behavioral tests

- [ ] Test Supabase read errors in every server action.
- [ ] Test RLS with authenticated and anonymous clients, not only service-role clients.
- [ ] Test multiple subscriptions and deterministic subscription selection.
- [ ] Test webhook compatibility using representative Stripe payload snapshots.
- [ ] Add an end-to-end demo test for signup, checkout redirect, webhook sync, dashboard access, and cancellation.

---

## P2 - Developer Experience And Operations

### Configurable public API

- [ ] Introduce a typed package configuration object or factory.
- [ ] Make checkout success, cancel, portal return, pricing, and login URLs configurable.
- [ ] Support checkout metadata passthrough without allowing callers to overwrite protected ownership metadata.
- [ ] Add dependency injection for Stripe, Supabase, authentication, and logging.
- [ ] Add a custom auth adapter while keeping Supabase Auth as the default.
- [ ] Return structured results where forced Next.js redirects unnecessarily limit consumers.

### Observability

- [ ] Add an optional structured logger to `createWebhookHandler`.
- [ ] Log event ID, event type, attempt, duration, outcome, and safe error details.
- [ ] Add a protected webhook health endpoint or query helper with last success, failure counts, and stale claims.
- [ ] Make Slack notification delivery non-blocking with a strict timeout.
- [ ] Document how to connect common logging and error-reporting providers.

### Documentation and compatibility

- [ ] Publish a compatibility matrix for Node.js, Next.js, Stripe SDK/API, Supabase JS, and Supabase SSR.
- [ ] Document the supported Stripe API version and upgrade policy.
- [ ] Document asynchronous payment behavior and webhook ordering guarantees.
- [ ] Document service-role handling and the RLS security model.
- [ ] Replace duplicated setup instructions with references to canonical assets.
- [ ] Keep the live demo deployment and README screenshots/workflows current.

---

## P3 - Billing Feature Expansion

### Near-term billing capabilities

- [ ] Configurable grace period for `past_due` subscriptions.
- [ ] Free-trial options in `createCheckout`.
- [ ] Promotion and coupon code support.
- [ ] Reactivate subscriptions pending period-end cancellation.
- [ ] Pause and resume subscription collection.
- [ ] Quantity and per-seat pricing support.
- [ ] Automatic tax and billing address collection.
- [ ] Idempotent checkout creation to prevent duplicate sessions from repeated submissions.

### Advanced billing capabilities

- [ ] Multiple subscription items with explicit item selection and updates.
- [ ] Usage-based and metered billing using the Stripe API supported by the pinned SDK version.
- [ ] Subscription schedules and future plan changes.
- [ ] Entitlement mapping from Stripe products/prices to application features.

---

## Completed Foundation

### Core billing

- [x] `createCheckout` supports one-time payment and subscription modes.
- [x] `getBillingPortal` redirects to the Stripe-hosted billing portal.
- [x] `getSubscription` fetches the current subscription row.
- [x] `requireActiveSubscription` guards subscription-only pages.
- [x] `changeSubscription` supports upgrades, downgrades, and proration control.
- [x] `cancelSubscription` supports period-end and immediate cancellation.

### Webhooks and testing

- [x] Stripe webhook signature verification.
- [x] Initial claim-before-process idempotency using `webhook_events`.
- [x] Subscription, checkout, invoice, and trial event routing.
- [x] Optional Slack failure alerts.
- [x] `buildWebhookRequest` and dahlia-compatible Stripe fixtures.
- [x] 120 unit tests across ten files.
- [x] 18 local Supabase integration tests across four files, enforced in CI (fails, not skips, if the
      stack or credentials are unavailable).

### Packaging and demonstration

- [x] Dual ESM and CJS builds with TypeScript declarations.
- [x] Public `/actions`, `/webhooks`, `/types`, and `/testing` entry points.
- [x] Supabase migration with RLS policies.
- [x] Next.js demo with authentication, pricing, checkout, dashboard, portal, and cancellation flows.
- [x] Live Vercel demo deployment.
- [x] CI for unit tests, typecheck, and package build.

---

## Current Verification Baseline

As of 2026-07-16 (0.3.0 release):

- Unit tests: 120 passed.
- TypeScript typecheck: passed.
- Package build: passed.
- Demo typecheck and production build: passed, against the published 0.3.0 package.
- npm package: published with 31 packaged files (includes `supabase/migrations/`).
- Integration tests: 18 passed against a local Supabase stack; CI fails (does not skip) if the stack or
  credentials are unavailable, or if fewer than 15 tests execute.
- Release workflow: gate steps (typecheck, unit tests, integration tests, build, tarball content
  assertion, import smoke test, demo build) all pass in CI; the final `npm publish` (OIDC) step does not
  — see the P0 "Known gap" note above.
