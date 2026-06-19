import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '../../database.types.js'

export const onCheckoutCompleted = async (
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<Database>
) => {
  const userId = session.metadata?.user_id ?? null

  if (session.mode === 'payment') {
    const { error } = await supabase.from('orders').insert({
      user_id: userId,
      stripe_session_id: session.id,
      amount: session.amount_total!,
      currency: session.currency!,
      status: 'paid',
    })
    if (error) throw error
    return
  }

  if (session.mode === 'subscription') {
    if (!userId) throw new Error(`Subscription checkout ${session.id} completed with no user_id in metadata`)
    if (!session.customer) throw new Error(`Subscription checkout ${session.id} completed with no customer`)
    const { error } = await supabase.from('stripe_customers').upsert(
      {
        user_id: userId,
        stripe_customer_id: session.customer as string,
      },
      { onConflict: 'user_id' }
    )
    if (error) throw error
  }
}
