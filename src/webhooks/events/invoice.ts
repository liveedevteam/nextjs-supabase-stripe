import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const getSubscriptionId = (invoice: Stripe.Invoice): string | null => {
  const sub = invoice.parent?.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

export const onInvoicePaid = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) => {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: new Date(invoice.period_start * 1000).toISOString(),
      current_period_end: new Date(invoice.period_end * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
  if (error) throw error
}

export const onPaymentFailed = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) => {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', subscriptionId)
  if (error) throw error
}

// Intentionally unimplemented. Add your own email/notification logic here.
// Stripe fires this ~3 days before a trial ends. The event is safe to ignore
// if you have no trial reminders; the subscription will auto-convert or cancel
// depending on your Stripe dashboard settings.
export const onTrialWillEnd = async (
  _subscription: Stripe.Subscription,
  _supabase: SupabaseClient
) => {}
