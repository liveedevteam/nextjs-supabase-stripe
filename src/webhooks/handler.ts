import { createClient } from '@supabase/supabase-js'
import { getStripeClient } from '../client.js'
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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const stripe = getStripeClient()
    const sig = req.headers.get('stripe-signature')!
    const body = await req.text()

    let event
    try {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
    } catch {
      return new Response('Invalid signature', { status: 400 })
    }

    const { data: existing } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('id', event.id)
      .single()

    if (existing) return new Response('Already processed', { status: 200 })

    try {
      await handleEvent(event, supabase)
    } catch (error) {
      if (options.slack?.webhookUrl) {
        await notifySlack(options.slack, event, error)
      }
      return new Response('Internal error', { status: 500 })
    }

    await supabase
      .from('webhook_events')
      .insert({ id: event.id, type: event.type })

    return new Response('OK', { status: 200 })
  }
