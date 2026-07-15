import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { vi } from 'vitest'
import type { Database } from '../../src/database.types.js'

// ─── Guard ────────────────────────────────────────────────────────────────────
// Tests describe.skipIf(skipIfNotLocal) so they degrade gracefully when local
// Supabase is not running (dev pointing at prod, credentials not set).
//
// Matches both `localhost` and `127.0.0.1` — `supabase status --output env`
// returns `http://127.0.0.1:54321`, not `localhost`, so a substring match on
// "localhost" alone silently skipped every test even with valid local
// credentials (see tests/integration/local-supabase-guard.test.ts). CI additionally
// asserts a minimum executed-test count (see ci.yml) so this guard being wrong
// again cannot produce a false-green run.
const LOCAL_SUPABASE_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/

export const isLocalSupabaseUrl = (url: string | undefined): boolean => LOCAL_SUPABASE_URL.test(url ?? '')

export const skipIfNotLocal =
  !process.env.SUPABASE_SERVICE_ROLE_KEY || !isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)

// ─── Service-role client ──────────────────────────────────────────────────────
// Separate from the handler's getServiceClient() singleton, but targets the
// same local DB. Used for seeding and post-handler assertions.
let _client: SupabaseClient<Database> | null = null
export function db(): SupabaseClient<Database> {
  if (!_client) {
    _client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder',
    )
  }
  return _client
}

// ─── Signing secret ───────────────────────────────────────────────────────────
// Must match STRIPE_WEBHOOK_SECRET set in vitest.integration.config.ts
export const WEBHOOK_SECRET = 'whsec_integration_test_secret'

// ─── Stripe stub ──────────────────────────────────────────────────────────────
// The webhook handler is fetch-driven (see src/webhooks/events/subscription-sync.ts):
// subscription and invoice events retrieve the subscription fresh from Stripe
// rather than trusting the event payload. Integration tests can't make live
// Stripe API calls, so pass createWebhookHandler({ stripe: stripeStub(...) }).
// constructEvent delegates to a real (network-free) Stripe SDK instance so
// signature verification behaves exactly like production; subscriptions.retrieve
// reads the `subscriptions` record at call time, not a snapshot — mutate it
// between handler() calls in a test to simulate Stripe's state changing
// between webhook deliveries.
const signingStripe = new Stripe('sk_test_integration_placeholder', { apiVersion: '2026-05-27.dahlia' })

export function stripeStub(subscriptions: Record<string, Stripe.Subscription> = {}): Stripe {
  return {
    webhooks: {
      constructEvent: signingStripe.webhooks.constructEvent.bind(signingStripe.webhooks),
    },
    subscriptions: {
      retrieve: vi.fn((id: string) => {
        const sub = subscriptions[id]
        if (!sub) throw new Error(`stripeStub: no subscription registered for id "${id}"`)
        return Promise.resolve(sub)
      }),
    },
  } as unknown as Stripe
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export async function seedUser(): Promise<string> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await db().auth.admin.createUser({
    email: `test-${tag}@example.com`,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('seedUser: no user returned')
  return data.user.id
}

export async function seedCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  const { error } = await db()
    .from('stripe_customers')
    .insert({ user_id: userId, stripe_customer_id: stripeCustomerId })
  if (error) throw error
}

export async function seedSubscription(params: {
  userId: string
  stripeSubscriptionId: string
  stripePriceId?: string
  status?: Database['public']['Tables']['subscriptions']['Insert']['status']
}): Promise<void> {
  const { error } = await db().from('subscriptions').insert({
    user_id: params.userId,
    stripe_subscription_id: params.stripeSubscriptionId,
    stripe_price_id: params.stripePriceId ?? 'price_test',
    status: params.status ?? 'active',
    current_period_start: new Date(1700000000 * 1000).toISOString(),
    current_period_end: new Date(1702678400 * 1000).toISOString(),
  })
  if (error) throw error
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────
// ON DELETE CASCADE in the migration means deleting from auth.users also
// removes stripe_customers and subscriptions. Orders need manual cleanup
// because user_id FK is ON DELETE SET NULL (nullable anonymous payments would persist).

export async function cleanupUser(userId: string): Promise<void> {
  await db().from('orders').delete().eq('user_id', userId)
  const { error } = await db().auth.admin.deleteUser(userId)
  if (error) throw error
}

export async function cleanupOrders(stripeSessionIds: string[]): Promise<void> {
  if (stripeSessionIds.length === 0) return
  await db().from('orders').delete().in('stripe_session_id', stripeSessionIds)
}

export async function cleanupWebhookEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return
  await db().from('webhook_events').delete().in('id', eventIds)
}

// ─── Request helper ───────────────────────────────────────────────────────────
// To read event ID without consuming the original request body:
//   const body = await req.clone().text()
//   const eventId = JSON.parse(body).id
//   const res = await handler(req)   ← original consumed here
