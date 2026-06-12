import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const resolveUserId = async (
  stripeCustomerId: string,
  supabase: SupabaseClient
): Promise<string> => {
  const { data } = await supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()
  if (!data) throw new Error(`No user found for customer: ${stripeCustomerId}`)
  return data.user_id
}

export const onSubscriptionUpdated = async (
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) => {
  const userId = await resolveUserId(subscription.customer as string, supabase)
  const price = subscription.items.data[0]?.price

  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: price?.id ?? '',
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
    { onConflict: 'stripe_subscription_id' }
  )
}

export const onSubscriptionDeleted = async (
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) => {
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('stripe_subscription_id', subscription.id)
}
