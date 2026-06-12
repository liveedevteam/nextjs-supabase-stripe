import { createClient } from '@supabase/supabase-js'
import { getStripeClient } from '../client.js'

export const backfillStripeCustomers = async () => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const stripe = getStripeClient()

  const { data: users } = await supabase.auth.admin.listUsers()

  for (const user of users.users) {
    const { data: existing } = await supabase
      .from('stripe_customers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (existing) continue

    const customer = await stripe.customers.create({ email: user.email! })

    await supabase.from('stripe_customers').insert({
      user_id: user.id,
      stripe_customer_id: customer.id,
    })

    await new Promise(r => setTimeout(r, 200))
  }
}

backfillStripeCustomers().catch(console.error)
