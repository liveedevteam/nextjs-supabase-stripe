'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServiceClient, getStripeClient } from '../client.js'
import type { Subscription } from '../types.js'

export type { Subscription }

const getAuthClient = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export async function createCheckout(priceId: string, mode: 'payment' | 'subscription') {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (mode === 'subscription' && !user) throw new Error('Unauthorized')

  // Reuse existing Stripe customer to avoid duplicates on re-subscription
  let existingCustomerId: string | undefined
  if (user) {
    const { data: customer } = await getServiceClient()
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()
    existingCustomerId = customer?.stripe_customer_id
  }

  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.create({
    mode,
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : user && { customer_email: user.email }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/cancel`,
    ...(user && { metadata: { user_id: user.id } }),
  })
  redirect(session.url!)
}

export async function getBillingPortal() {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: customer } = await getServiceClient()
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!customer) throw new Error('No Stripe customer found for this user')

  const stripe = getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
  })
  redirect(session.url!)
}

export async function getSubscription(): Promise<Subscription | null> {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await getServiceClient()
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .neq('status', 'canceled')
    .neq('status', 'incomplete_expired')
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}

export async function changeSubscription(
  newPriceId: string,
  prorationBehavior: 'create_prorations' | 'none' | 'always_invoice' = 'create_prorations'
): Promise<void> {
  const authClient = await getAuthClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: sub } = await getServiceClient()
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', user.id)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sub) throw new Error('No active subscription found')

  const stripe = getStripeClient()
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
  const item = stripeSub.items.data[0]
  if (!item) throw new Error(`Subscription ${sub.stripe_subscription_id} has no items`)

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: item.id, price: newPriceId }],
    proration_behavior: prorationBehavior,
  })
  // customer.subscription.updated webhook fires and the existing handler updates the DB
}

export async function requireActiveSubscription() {
  const subscription = await getSubscription()
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
    redirect('/pricing')
  }
}
