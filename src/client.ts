import { SupabaseClient, createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import type { Database } from './database.types.js'

let stripeInstance: Stripe | null = null

export const getStripeClient = () => {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-05-27.dahlia',
      typescript: true,
    })
  }
  return stripeInstance
}

let supabaseInstance: SupabaseClient<Database> | null = null

export const getServiceClient = (): SupabaseClient<Database> => {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return supabaseInstance
}
