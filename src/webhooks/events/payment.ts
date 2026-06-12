import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

export const onPaymentIntentSucceeded = async (
  paymentIntent: Stripe.PaymentIntent,
  supabase: SupabaseClient
) => {
  await supabase
    .from('orders')
    .update({ status: 'paid' })
    .eq('stripe_session_id', paymentIntent.id)
}
