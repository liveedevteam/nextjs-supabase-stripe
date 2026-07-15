import type { Database } from './database.types.js'

// database.types.ts is generated straight from the schema (see its header),
// so it can't express the fixed set of values `status` is written from in
// src/webhooks/events/subscription.ts. That narrowing lives here instead.
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid'
  | 'paused'

export type Subscription = Omit<Database['public']['Tables']['subscriptions']['Row'], 'status'> & {
  status: SubscriptionStatus
}

export type { Database }
