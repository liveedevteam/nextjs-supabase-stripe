import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '../../database.types.js'
import { syncSubscriptionFromStripe } from './subscription-sync.js'

// customer.subscription.created and .updated both just mean "go re-read the
// current state of this subscription from Stripe" — see subscription-sync.ts.
export const onSubscriptionUpdated = async (
  subscription: Stripe.Subscription,
  supabase: SupabaseClient<Database>,
  stripe: Stripe
): Promise<void> => syncSubscriptionFromStripe(subscription.id, stripe, supabase)

// Subscriptions are never hard-deleted in Stripe — cancellation just flips
// status to 'canceled' — so the same fetch-and-upsert applies here too.
export const onSubscriptionDeleted = async (
  subscription: Stripe.Subscription,
  supabase: SupabaseClient<Database>,
  stripe: Stripe
): Promise<void> => syncSubscriptionFromStripe(subscription.id, stripe, supabase)
