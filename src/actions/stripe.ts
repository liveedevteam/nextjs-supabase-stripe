'use server'

import { createClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { getStripeClient } from '../client.js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function createCheckout(priceId: string, mode: 'payment' | 'subscription') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.create({
    mode,
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/cancel`,
    metadata: { user_id: user.id },
  })
  redirect(session.url!)
}

export async function getBillingPortal() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: customer } = await supabase
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  const stripe = getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: customer!.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  })
  redirect(session.url!)
}

export async function getSubscription() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return data
}

export async function requireActiveSubscription() {
  const subscription = await getSubscription()
  if (!subscription || subscription.status !== 'active') {
    redirect('/pricing')
  }
}
