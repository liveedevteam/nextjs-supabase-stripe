import type Stripe from 'stripe'
import { getServiceClient, getStripeClient } from '../client.js'
import { MissingEnvironmentVariableError } from '../errors.js'
import { handleEvent } from './events/index.js'
import { notifySlack } from './notifier.js'

export { MissingEnvironmentVariableError }

interface WebhookHandlerOptions {
  slack?: {
    webhookUrl: string
    channel?: string
  }
  /**
   * Override the Stripe client used for signature verification and for
   * fetching current subscription state. Defaults to getStripeClient().
   * Exists for integration tests, which can't make live Stripe API calls —
   * see tests/integration/setup.ts's stripeStub.
   */
  stripe?: Stripe
}

export const createWebhookHandler = (options: WebhookHandlerOptions = {}) =>
  async (req: Request): Promise<Response> => {
    // Validated per-request, not at createWebhookHandler() call time — that
    // call typically happens at module scope in a route.ts file
    // (`export const POST = createWebhookHandler()`), which Next.js
    // evaluates during build before real env vars are necessarily present.
    let supabase: ReturnType<typeof getServiceClient>
    let stripe: Stripe
    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new MissingEnvironmentVariableError('createWebhookHandler', ['STRIPE_WEBHOOK_SECRET'])
      }
      supabase = getServiceClient()
      stripe = options.stripe ?? getStripeClient()
    } catch (err) {
      if (err instanceof MissingEnvironmentVariableError) {
        console.error(err.message)
        return new Response(err.message, { status: 500 })
      }
      throw err
    }

    const sig = req.headers.get('stripe-signature')!
    const body = await req.text()

    let event
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
    } catch {
      return new Response('Invalid signature', { status: 400 })
    }

    // Claim the event before processing so concurrent retries are blocked by the unique constraint
    const { error: claimError } = await supabase
      .from('webhook_events')
      .insert({ id: event.id, type: event.type })

    if (claimError?.code === '23505') return new Response('Already processed', { status: 200 })
    if (claimError) return new Response('Database error', { status: 500 })

    try {
      await handleEvent(event, supabase, stripe)
    } catch (error) {
      // Release the claim so Stripe can retry
      await supabase.from('webhook_events').delete().eq('id', event.id)
      if (options.slack?.webhookUrl) {
        await notifySlack(options.slack, event, error).catch(() => {})
      }
      return new Response('Internal error', { status: 500 })
    }

    return new Response('OK', { status: 200 })
  }
