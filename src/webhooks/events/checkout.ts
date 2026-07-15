import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '../../database.types.js'

export const onCheckoutCompleted = async (
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<Database>
) => {
  const userId = session.metadata?.user_id ?? null

  if (session.mode === 'payment') {
    if (session.amount_total == null) {
      throw new Error(`Checkout session ${session.id} completed with no amount_total`)
    }
    if (!session.currency) {
      throw new Error(`Checkout session ${session.id} completed with no currency`)
    }
    // A completed Checkout Session isn't necessarily a paid order — delayed
    // payment methods (bank debits, some redirect methods) complete the
    // session before the payment itself has cleared. payment_status tells
    // the truth; async_payment_succeeded/failed (checkout.ts, same file)
    // transition pending → paid/failed when it clears.
    const status = session.payment_status === 'paid' ? 'paid' : 'pending'
    const { error } = await supabase.from('orders').insert({
      user_id: userId,
      stripe_session_id: session.id,
      amount: session.amount_total,
      currency: session.currency,
      status,
    })
    if (error) throw error
    return
  }

  if (session.mode === 'subscription') {
    if (!userId) throw new Error(`Subscription checkout ${session.id} completed with no user_id in metadata`)
    if (!session.customer) throw new Error(`Subscription checkout ${session.id} completed with no customer`)
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id
    const { error } = await supabase.from('stripe_customers').upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
      },
      { onConflict: 'user_id' }
    )
    if (error) throw error
  }
}

// Fires when a delayed payment method (e.g. a bank debit) that was pending
// at checkout.session.completed has now actually cleared.
export const onCheckoutAsyncPaymentSucceeded = async (
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<Database>
) => {
  const { error } = await supabase.from('orders').update({ status: 'paid' }).eq('stripe_session_id', session.id)
  if (error) throw error
}

// Counterpart to onCheckoutAsyncPaymentSucceeded — the delayed payment failed.
export const onCheckoutAsyncPaymentFailed = async (
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<Database>
) => {
  const { error } = await supabase.from('orders').update({ status: 'failed' }).eq('stripe_session_id', session.id)
  if (error) throw error
}
