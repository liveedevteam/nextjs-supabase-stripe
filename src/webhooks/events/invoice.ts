import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

export const onInvoicePaid = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) => {
  if (!invoice.subscription) return

  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: new Date((invoice.period_start) * 1000).toISOString(),
      current_period_end: new Date((invoice.period_end) * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', invoice.subscription as string)
}

export const onPaymentFailed = async (
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) => {
  if (!invoice.subscription) return

  await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', invoice.subscription as string)
}

export const onTrialWillEnd = async (
  _subscription: Stripe.Subscription,
  _supabase: SupabaseClient
) => {
  // Extend here to email the user or trigger a notification
}
