import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { onCheckoutCompleted } from './checkout.js'
import { onInvoicePaid, onPaymentFailed, onTrialWillEnd } from './invoice.js'
import { onSubscriptionDeleted, onSubscriptionUpdated } from './subscription.js'

export const handleEvent = async (event: Stripe.Event, supabase: SupabaseClient) => {
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return onSubscriptionUpdated(event.data.object as Stripe.Subscription, supabase)
    case 'customer.subscription.deleted':
      return onSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase)
    case 'invoice.paid':
      return onInvoicePaid(event.data.object as Stripe.Invoice, supabase)
    case 'invoice.payment_failed':
      return onPaymentFailed(event.data.object as Stripe.Invoice, supabase)
    case 'customer.subscription.trial_will_end':
      return onTrialWillEnd(event.data.object as Stripe.Subscription, supabase)
  }
}
