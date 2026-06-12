import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

export const onCheckoutCompleted = async (
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient
) => {
  const userId = session.metadata?.user_id ?? null

  if (session.mode === 'payment') {
    await supabase.from('orders').insert({
      user_id: userId,
      stripe_session_id: session.id,
      amount: session.amount_total!,
      currency: session.currency!,
      status: 'paid',
    })
    return
  }

  if (session.mode === 'subscription' && session.customer && userId) {
    await supabase.from('stripe_customers').upsert(
      {
        user_id: userId,
        stripe_customer_id: session.customer as string,
      },
      { onConflict: 'user_id' }
    )
  }
}
