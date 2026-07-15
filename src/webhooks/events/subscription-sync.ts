import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '../../database.types.js'

const resolveUserId = async (
  stripeCustomerId: string,
  supabase: SupabaseClient<Database>
): Promise<string> => {
  const { data } = await supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()
  if (!data) throw new Error(`No user found for customer: ${stripeCustomerId}`)
  return data.user_id
}

// Every subscription-lifecycle event (created/updated/deleted, invoice paid/
// failed) converges on this single function instead of writing whatever
// fields happened to be on that event's payload. Retrieving the subscription
// fresh from Stripe and upserting *that* means:
//   - out-of-order webhook delivery can't regress state — two events for the
//     same subscription, delivered in either order, both write the same
//     current truth
//   - invoice.paid can't reactivate a subscription Stripe has since canceled
//     — if it's canceled, the fetch says so
//   - expanded vs unexpanded `customer`/price objects on the event payload
//     stop mattering, since none of that payload is trusted
// Subscriptions are never hard-deleted in Stripe (cancellation just flips
// status to 'canceled'), so retrieve() keeps working after
// customer.subscription.deleted too.
export const syncSubscriptionFromStripe = async (
  subscriptionId: string,
  stripe: Stripe,
  supabase: SupabaseClient<Database>
): Promise<void> => {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  const item = subscription.items.data[0]
  if (!item) throw new Error(`Subscription ${subscription.id} has no items`)

  const priceId = item.price?.id
  if (!priceId) throw new Error(`Subscription ${subscription.id} item has no price id`)

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
  const userId = await resolveUserId(customerId, supabase)

  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      status: subscription.status,
      current_period_start: new Date(item.current_period_start * 1000).toISOString(),
      current_period_end: new Date(item.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
    },
    { onConflict: 'stripe_subscription_id' }
  )
  if (error) throw error
}
