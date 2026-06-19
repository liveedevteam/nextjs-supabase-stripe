import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWebhookHandler } from '../webhooks/handler.js'
import { mockSupabase } from './helpers.js'

vi.mock('../client.js', () => ({
  getStripeClient: vi.fn(),
  getServiceClient: vi.fn(),
}))
vi.mock('../webhooks/events/index.js', () => ({ handleEvent: vi.fn() }))
vi.mock('../webhooks/notifier.js', () => ({ notifySlack: vi.fn() }))

import { getStripeClient, getServiceClient } from '../client.js'
import { handleEvent } from '../webhooks/events/index.js'
import { notifySlack } from '../webhooks/notifier.js'

const MOCK_EVENT = { id: 'evt_123', type: 'checkout.session.completed' }

const mockConstructEvent = vi.fn()
const mockStripe = { webhooks: { constructEvent: mockConstructEvent } }

const req = (body = '{}', sig: string | null = 'valid-sig') =>
  ({
    headers: { get: (k: string) => (k === 'stripe-signature' ? sig : null) },
    text: async () => body,
  } as unknown as Request)

beforeEach(() => {
  vi.clearAllMocks()
  mockConstructEvent.mockReturnValue(MOCK_EVENT)
  vi.mocked(getStripeClient).mockReturnValue(mockStripe as any)
})

describe('createWebhookHandler', () => {
  it('processes a valid event and returns 200', async () => {
    const { supabase } = mockSupabase({ webhook_events: {} })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    vi.mocked(handleEvent).mockResolvedValue(undefined)

    const res = await createWebhookHandler()(req())
    expect(res.status).toBe(200)
    expect(handleEvent).toHaveBeenCalledWith(MOCK_EVENT, supabase)
  })

  it('returns 200 "Already processed" when event ID is already in webhook_events (23505)', async () => {
    const { supabase } = mockSupabase({
      webhook_events: { insert: { error: { code: '23505' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    const res = await createWebhookHandler()(req())
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Already processed')
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it('returns 500 "Database error" on a non-23505 DB error during claim', async () => {
    const { supabase } = mockSupabase({
      webhook_events: { insert: { error: { code: '42000', message: 'syntax error' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    const res = await createWebhookHandler()(req())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Database error')
  })

  it('returns 400 on invalid Stripe signature', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('No signatures found') })
    const { supabase } = mockSupabase({})
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    const res = await createWebhookHandler()(req('{}', 'bad-sig'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when stripe-signature header is missing', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('No signatures found') })
    const { supabase } = mockSupabase({})
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    const res = await createWebhookHandler()(req('{}', null))
    expect(res.status).toBe(400)
  })

  it('deletes claim and returns 500 when handleEvent throws', async () => {
    const { supabase, spies } = mockSupabase({ webhook_events: {} })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    vi.mocked(handleEvent).mockRejectedValue(new Error('processing error'))

    const res = await createWebhookHandler()(req())
    expect(res.status).toBe(500)
    expect(spies('webhook_events').deleteFn).toHaveBeenCalled()
    expect(spies('webhook_events').deleteEqFn).toHaveBeenCalledWith('id', MOCK_EVENT.id)
  })

  it('calls notifySlack when handleEvent throws and slack is configured', async () => {
    const { supabase } = mockSupabase({ webhook_events: {} })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    const processingError = new Error('processing error')
    vi.mocked(handleEvent).mockRejectedValue(processingError)
    vi.mocked(notifySlack).mockResolvedValue(undefined)

    const slackConfig = { webhookUrl: 'https://hooks.slack.com/test', channel: '#alerts' }
    await createWebhookHandler({ slack: slackConfig })(req())
    expect(notifySlack).toHaveBeenCalledWith(slackConfig, MOCK_EVENT, processingError)
  })

  it('still returns 500 when handleEvent throws and notifySlack itself fails (bug regression)', async () => {
    const { supabase } = mockSupabase({ webhook_events: {} })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    vi.mocked(handleEvent).mockRejectedValue(new Error('processing error'))
    vi.mocked(notifySlack).mockRejectedValue(new Error('Slack is down'))

    const res = await createWebhookHandler({ slack: { webhookUrl: 'https://hooks.slack.com/test' } })(req())
    expect(res.status).toBe(500)
  })
})
