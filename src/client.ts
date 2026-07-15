import { SupabaseClient, createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import type { Database } from './database.types.js'
import { MissingEnvironmentVariableError } from './errors.js'

let stripeInstance: Stripe | null = null

// Validated lazily, at first construction — not at module import time. This
// package is imported by Next.js during build (route/module graph analysis)
// where env vars legitimately aren't set yet; failing on import would break
// builds. Importing only /testing or /types should never require any of
// these vars either, since those entry points never call this function.
export const getStripeClient = () => {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new MissingEnvironmentVariableError('Stripe client', ['STRIPE_SECRET_KEY'])
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-05-27.dahlia',
      typescript: true,
    })
  }
  return stripeInstance
}

let supabaseInstance: SupabaseClient<Database> | null = null

export const getServiceClient = (): SupabaseClient<Database> => {
  if (!supabaseInstance) {
    const missing = [
      !process.env.NEXT_PUBLIC_SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
      !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter((v): v is string => Boolean(v))
    if (missing.length > 0) {
      throw new MissingEnvironmentVariableError('Supabase service client', missing)
    }
    supabaseInstance = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return supabaseInstance
}
