import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '../../database.types.js'
import { syncSubscriptionFromStripe } from './subscription-sync.js'

const getSubscriptionId = (invoice: Stripe.Invoice): string | null => {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

// invoice.paid and invoice.payment_failed both resolve to "go re-read the
// current state of this subscription from Stripe" — see subscription-sync.ts.
// This is what stops a delayed invoice.paid from reactivating a subscription
// Stripe has since canceled: the fetch reflects the cancellation, not the
// invoice event's own (possibly stale-by-the-time-it's-processed) payload.
export const onInvoicePaid = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient<Database>,
  stripe: Stripe
): Promise<void> => {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return
  await syncSubscriptionFromStripe(subscriptionId, stripe, supabase)
}

export const onPaymentFailed = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient<Database>,
  stripe: Stripe
): Promise<void> => {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return
  await syncSubscriptionFromStripe(subscriptionId, stripe, supabase)
}

// Intentionally unimplemented. Add your own email/notification logic here.
// Stripe fires this ~3 days before a trial ends. The event is safe to ignore
// if you have no trial reminders; the subscription will auto-convert or cancel
// depending on your Stripe dashboard settings.
export const onTrialWillEnd = async (
  _subscription: Stripe.Subscription,
  _supabase: SupabaseClient<Database>
) => {}
