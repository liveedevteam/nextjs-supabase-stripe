'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServiceClient, getStripeClient } from '../client.js'
import {
  CustomerNotFoundError,
  DatabaseError,
  InvalidRedirectUrlError,
  NoActiveSubscriptionError,
  UnauthorizedError,
} from '../errors.js'
import type { Subscription } from '../types.js'

export type { Subscription }
export { CustomerNotFoundError, DatabaseError, InvalidRedirectUrlError, NoActiveSubscriptionError, UnauthorizedError }

// NEXT_PUBLIC_APP_URL is validated here rather than eagerly at import time —
// same reasoning as getStripeClient()/getServiceClient() in client.ts.
const resolveAppUrl = (path: string): string => {
  try {
    return new URL(path, process.env.NEXT_PUBLIC_APP_URL).toString()
  } catch {
    throw new InvalidRedirectUrlError(process.env.NEXT_PUBLIC_APP_URL)
  }
}

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

  if (mode === 'subscription' && !user) throw new UnauthorizedError()

  // Reuse existing Stripe customer to avoid duplicates on re-subscription.
  // PGRST116 ("no rows") from .single() is expected here — anyone without a
  // prior subscription checkout has no stripe_customers row yet. Any other
  // error is a real database failure and must not be treated as "no customer".
  let existingCustomerId: string | undefined
  if (user) {
    const { data: customer, error } = await getServiceClient()
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()
    if (error && error.code !== 'PGRST116') throw new DatabaseError('looking up Stripe customer', error)
    existingCustomerId = customer?.stripe_customer_id
  }

  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.create({
    mode,
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : user && { customer_email: user.email }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: resolveAppUrl('/success'),
    cancel_url: resolveAppUrl('/cancel'),
    ...(user && { metadata: { user_id: user.id } }),
  })
  redirect(session.url!)
}

export async function getBillingPortal() {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new UnauthorizedError()

  const { data: customer, error } = await getServiceClient()
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') throw new DatabaseError('looking up Stripe customer', error)
  if (!customer) throw new CustomerNotFoundError()

  const stripe = getStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: resolveAppUrl('/settings/billing'),
  })
  redirect(session.url!)
}

export async function getSubscription(): Promise<Subscription | null> {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await getServiceClient()
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .neq('status', 'canceled')
    .neq('status', 'incomplete_expired')
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  // .maybeSingle() returns error: null on zero rows — a real error here means
  // the query itself failed, which must not be reported as "no subscription".
  if (error) throw new DatabaseError('looking up subscription', error)

  // `status` is `text` in Postgres (no CHECK constraint), so the generated
  // Database type is honestly just `string`. This package's webhook handler
  // is the only writer and only ever writes SubscriptionStatus values.
  return data as Subscription | null
}

export async function cancelSubscription(immediately = false): Promise<void> {
  const authClient = await getAuthClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new UnauthorizedError()

  const { data: sub, error } = await getServiceClient()
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', user.id)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new DatabaseError('looking up subscription', error)
  if (!sub) throw new NoActiveSubscriptionError()

  const stripe = getStripeClient()
  if (immediately) {
    await stripe.subscriptions.cancel(sub.stripe_subscription_id)
    // customer.subscription.deleted fires → existing handler sets status: 'canceled'
  } else {
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    })
    // customer.subscription.updated fires → existing handler writes cancel_at_period_end: true
  }
}

export async function changeSubscription(
  newPriceId: string,
  prorationBehavior: 'create_prorations' | 'none' | 'always_invoice' = 'create_prorations'
): Promise<void> {
  const authClient = await getAuthClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new UnauthorizedError()

  const { data: sub, error } = await getServiceClient()
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', user.id)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new DatabaseError('looking up subscription', error)
  if (!sub) throw new NoActiveSubscriptionError()

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
