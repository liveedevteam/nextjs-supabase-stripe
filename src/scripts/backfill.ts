import Stripe from 'stripe'
import { getServiceClient, getStripeClient } from '../client.js'

// Matches by email only — users who changed their email after paying will not be found.
// Review any skipped users manually in the Stripe dashboard if needed.
const listCustomerByEmail = async (stripe: Stripe, email: string) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await stripe.customers.list({ email, limit: 1 })
    } catch (err) {
      if (err instanceof Stripe.errors.StripeRateLimitError && attempt < 3) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1000))
        continue
      }
      throw err
    }
  }
}

export const backfillStripeCustomers = async () => {
  const supabase = getServiceClient()
  const stripe = getStripeClient()

  const perPage = 1000
  let page = 1

  while (true) {
    const { data: batch, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    if (!batch.users.length) break

  for (const user of batch.users) {
    const { data: existing } = await supabase
      .from('stripe_customers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (existing) continue

    // Only sync users who already have a Stripe customer — do not create new ones
    const results = await listCustomerByEmail(stripe, user.email!)
    if (!results || results.data.length === 0) continue

    await supabase.from('stripe_customers').insert({
      user_id: user.id,
      stripe_customer_id: results.data[0].id,
    })

    await new Promise(r => setTimeout(r, 200))
  }

  if (batch.users.length < perPage) break
  page++
  }
}

backfillStripeCustomers().catch(console.error)
