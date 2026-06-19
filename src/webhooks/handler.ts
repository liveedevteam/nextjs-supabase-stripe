import { getServiceClient, getStripeClient } from '../client.js'
import { handleEvent } from './events/index.js'
import { notifySlack } from './notifier.js'

interface WebhookHandlerOptions {
  slack?: {
    webhookUrl: string
    channel?: string
  }
}

export const createWebhookHandler = (options: WebhookHandlerOptions = {}) =>
  async (req: Request): Promise<Response> => {
    const supabase = getServiceClient()
    const stripe = getStripeClient()
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
      await handleEvent(event, supabase)
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
