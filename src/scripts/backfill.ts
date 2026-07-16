import type { SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getServiceClient, getStripeClient } from '../client.js'
import type { Database } from '../database.types.js'

export interface BackfillResult {
  totalUsers: number
  /** User IDs newly linked to a Stripe customer (or that would be, in dry-run mode). */
  matched: string[]
  /** User IDs that already had a stripe_customers row. */
  alreadySynced: string[]
  /** User IDs with no email address — cannot be matched by email. */
  noEmail: string[]
  /** User IDs whose email matched no Stripe customer. Expected for users who never paid. */
  noStripeCustomer: string[]
  /** Users whose email matched more than one Stripe customer — never guessed, always needs a human. */
  ambiguous: { userId: string; email: string; stripeCustomerIds: string[] }[]
  /** Users a real error occurred for (DB failure, non-rate-limit Stripe error). Never silently dropped. */
  failed: { userId: string; error: string }[]
}

const emptyResult = (): BackfillResult => ({
  totalUsers: 0,
  matched: [],
  alreadySynced: [],
  noEmail: [],
  noStripeCustomer: [],
  ambiguous: [],
  failed: [],
})

// limit: 2 (not 1) so a genuine ambiguous match — two+ Stripe customers
// sharing the same email — is detectable instead of silently picking
// whichever one the API happens to return first.
const listCustomersByEmail = async (stripe: Stripe, email: string): Promise<Stripe.Customer[]> => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await stripe.customers.list({ email, limit: 2 })
      return result.data
    } catch (err) {
      if (err instanceof Stripe.errors.StripeRateLimitError && attempt < 3) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
        continue
      }
      throw err
    }
  }
  // Unreachable: the loop above either returns or throws on every iteration.
  throw new Error(`listCustomersByEmail: exhausted retries for ${email}`)
}

interface BackfillUser {
  id: string
  email?: string
}

const processUser = async (
  user: BackfillUser,
  supabase: SupabaseClient<Database>,
  stripe: Stripe,
  dryRun: boolean,
  result: BackfillResult
): Promise<void> => {
  // stripe_customers.user_id is the primary key (see supabase/migrations) —
  // selecting a nonexistent `id` column here was the original bug that made
  // this script error on every single user.
  const { data: existing, error: selectError } = await supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (selectError) {
    result.failed.push({ userId: user.id, error: `stripe_customers lookup failed: ${selectError.message}` })
    return
  }
  if (existing) {
    result.alreadySynced.push(user.id)
    return
  }

  if (!user.email) {
    result.noEmail.push(user.id)
    return
  }

  let customers: Stripe.Customer[]
  try {
    customers = await listCustomersByEmail(stripe, user.email)
  } catch (err) {
    result.failed.push({ userId: user.id, error: `Stripe customer lookup failed: ${err instanceof Error ? err.message : String(err)}` })
    return
  }

  if (customers.length === 0) {
    result.noStripeCustomer.push(user.id)
    return
  }
  if (customers.length > 1) {
    result.ambiguous.push({ userId: user.id, email: user.email, stripeCustomerIds: customers.map((c) => c.id) })
    return
  }

  const stripeCustomerId = customers[0].id
  if (!dryRun) {
    const { error: insertError } = await supabase
      .from('stripe_customers')
      .insert({ user_id: user.id, stripe_customer_id: stripeCustomerId })
    if (insertError) {
      result.failed.push({ userId: user.id, error: `stripe_customers insert failed: ${insertError.message}` })
      return
    }
  }
  result.matched.push(user.id)
}

export interface BackfillOptions {
  supabase?: SupabaseClient<Database>
  stripe?: Stripe
  /** When true, does everything except the actual insert. Default: false. */
  dryRun?: boolean
  /** Delay between per-user Stripe calls, in ms. Default: 200. */
  throttleMs?: number
}

/**
 * Syncs existing Stripe customers into the stripe_customers table by looking
 * them up in Stripe by email. Does not create new Stripe customers — only
 * records users who already exist in Stripe. Never guesses on an ambiguous
 * email match, and never silently drops a failure — see BackfillResult.
 */
export const backfillStripeCustomers = async (options: BackfillOptions = {}): Promise<BackfillResult> => {
  const supabase = options.supabase ?? getServiceClient()
  const stripe = options.stripe ?? getStripeClient()
  const dryRun = options.dryRun ?? false
  const throttleMs = options.throttleMs ?? 200

  const result = emptyResult()
  const perPage = 1000
  let page = 1

  while (true) {
    const { data: batch, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Failed to list users (page ${page}): ${error.message}`)
    if (!batch.users.length) break

    for (const user of batch.users) {
      result.totalUsers++
      await processUser(user, supabase, stripe, dryRun, result)
      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs))
    }

    if (batch.users.length < perPage) break
    page++
  }

  return result
}

const printSummary = (result: BackfillResult, dryRun: boolean): void => {
  const line = (label: string, n: number) => console.log(`  ${label.padEnd(24)} ${n}`)
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfill complete.`)
  line('Total users checked:', result.totalUsers)
  line(dryRun ? 'Would match:' : 'Matched:', result.matched.length)
  line('Already synced:', result.alreadySynced.length)
  line('No email:', result.noEmail.length)
  line('No Stripe customer:', result.noStripeCustomer.length)
  line('Ambiguous:', result.ambiguous.length)
  line('Failed:', result.failed.length)

  if (result.ambiguous.length > 0) {
    console.log('\nAmbiguous — multiple Stripe customers share this email, review manually:')
    for (const a of result.ambiguous) {
      console.log(`  user ${a.userId} (${a.email}): ${a.stripeCustomerIds.join(', ')}`)
    }
  }
  if (result.failed.length > 0) {
    console.log('\nFailed:')
    for (const f of result.failed) console.log(`  user ${f.userId}: ${f.error}`)
  }
}

// Only runs when this file is executed directly (`node dist/scripts/backfill.js`),
// never when backfillStripeCustomers is imported for tests.
const isMain = (): boolean => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
  } catch {
    return false
  }
}

if (isMain()) {
  const dryRun = process.argv.includes('--dry-run')
  backfillStripeCustomers({ dryRun })
    .then((result) => {
      printSummary(result, dryRun)
      if (result.failed.length > 0) process.exitCode = 1
    })
    .catch((err) => {
      console.error('Backfill failed:', err)
      process.exitCode = 1
    })
}
