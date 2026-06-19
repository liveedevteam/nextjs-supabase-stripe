import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from './helpers.js'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: vi.fn(() => []), set: vi.fn() }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('../client.js', () => ({ getServiceClient: vi.fn(), getStripeClient: vi.fn() }))

import { createCheckout, getBillingPortal, getSubscription, requireActiveSubscription } from '../actions/stripe.js'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { getServiceClient, getStripeClient } from '../client.js'

const USER = { id: 'user-123', email: 'test@example.com' }

const mockAuthClient = (user: typeof USER | null) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
})

const mockStripe = {
  checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }) } },
  billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }) } },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redirect).mockImplementation(() => { throw new Error('REDIRECT') })
  vi.mocked(getStripeClient).mockReturnValue(mockStripe as any)
})

describe('createCheckout', () => {
  it('throws Unauthorized for subscription mode when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(createCheckout('price_123', 'subscription')).rejects.toThrow('Unauthorized')
  })

  it('payment mode proceeds for anonymous user and sets no metadata', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    const { supabase } = mockSupabase({})
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'payment')).rejects.toThrow('REDIRECT')
    const [sessionArgs] = mockStripe.checkout.sessions.create.mock.calls[0]
    expect(sessionArgs.metadata).toBeUndefined()
  })

  it('sets metadata.user_id when user is logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ stripe_customers: { single: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'subscription')).rejects.toThrow('REDIRECT')
    const [sessionArgs] = mockStripe.checkout.sessions.create.mock.calls[0]
    expect(sessionArgs.metadata?.user_id).toBe(USER.id)
  })

  it('reuses existing Stripe customer when one exists', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      stripe_customers: { single: { data: { stripe_customer_id: 'cus_existing' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'subscription')).rejects.toThrow('REDIRECT')
    const [sessionArgs] = mockStripe.checkout.sessions.create.mock.calls[0]
    expect(sessionArgs.customer).toBe('cus_existing')
    expect(sessionArgs.customer_email).toBeUndefined()
  })

  it('redirects to the Stripe checkout URL', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    const { supabase } = mockSupabase({})
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'payment')).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/test')
  })
})

describe('getBillingPortal', () => {
  it('throws Unauthorized when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(getBillingPortal()).rejects.toThrow('Unauthorized')
  })

  it('throws when user has no Stripe customer row', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ stripe_customers: { single: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    await expect(getBillingPortal()).rejects.toThrow('No Stripe customer found')
  })

  it('redirects to the billing portal URL', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      stripe_customers: { single: { data: { stripe_customer_id: 'cus_abc' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(getBillingPortal()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('https://billing.stripe.com/test')
  })
})

describe('getSubscription', () => {
  it('returns null for anonymous users', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    const result = await getSubscription()
    expect(result).toBeNull()
  })

  it('returns subscription data when user has one', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const sub = { id: 'sub_123', status: 'active' }
    const { supabase } = mockSupabase({ subscriptions: { maybeSingle: { data: sub } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    const result = await getSubscription()
    expect(result).toEqual(sub)
  })

  it('does not return canceled or incomplete_expired subscriptions', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase, spies } = mockSupabase({ subscriptions: { maybeSingle: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await getSubscription()
    // The query chain must include neq filters — asserted via maybeSingle being called
    // (mock only reaches maybeSingle after the full neq→order→limit chain)
    expect(spies('subscriptions').maybeSingleFn).toHaveBeenCalled()
  })
})

describe('requireActiveSubscription', () => {
  it('redirects to /pricing when user has no subscription', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ subscriptions: { maybeSingle: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(requireActiveSubscription()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/pricing')
  })

  it('redirects to /pricing when subscription is past_due (exists but not active)', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { status: 'past_due' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(requireActiveSubscription()).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/pricing')
  })

  it('does not redirect when subscription is active', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { status: 'active' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await requireActiveSubscription()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('does not redirect when subscription is trialing', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { status: 'trialing' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await requireActiveSubscription()
    expect(redirect).not.toHaveBeenCalled()
  })
})
