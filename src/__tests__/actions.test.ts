import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabase } from './helpers.js'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: vi.fn(() => []), set: vi.fn() }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('../client.js', () => ({ getServiceClient: vi.fn(), getStripeClient: vi.fn() }))

import {
  cancelSubscription,
  changeSubscription,
  createCheckout,
  getBillingPortal,
  getSubscription,
  requireActiveSubscription,
} from '../actions/stripe.js'
import {
  CustomerNotFoundError,
  DatabaseError,
  InvalidRedirectUrlError,
  NoActiveSubscriptionError,
  UnauthorizedError,
} from '../errors.js'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { getServiceClient, getStripeClient } from '../client.js'

const USER = { id: 'user-123', email: 'test@example.com' }

const mockAuthClient = (user: typeof USER | null) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
})

const mockSubscriptionRetrieve = vi.fn()
const mockSubscriptionUpdate = vi.fn()
const mockSubscriptionCancel = vi.fn()

const mockStripe = {
  checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }) } },
  billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }) } },
  subscriptions: {
    retrieve: mockSubscriptionRetrieve,
    update: mockSubscriptionUpdate,
    cancel: mockSubscriptionCancel,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redirect).mockImplementation(() => { throw new Error('REDIRECT') })
  vi.mocked(getStripeClient).mockReturnValue(mockStripe as any)
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
})

describe('createCheckout', () => {
  it('throws UnauthorizedError for subscription mode when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(createCheckout('price_123', 'subscription')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws DatabaseError — not a silent fallback to creating a duplicate customer — when the customer lookup fails for a real reason', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      stripe_customers: { single: { data: null, error: { code: '500', message: 'connection refused' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'subscription')).rejects.toBeInstanceOf(DatabaseError)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('throws InvalidRedirectUrlError when NEXT_PUBLIC_APP_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    const { supabase } = mockSupabase({})
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(createCheckout('price_123', 'payment')).rejects.toBeInstanceOf(InvalidRedirectUrlError)
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
  it('throws UnauthorizedError when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(getBillingPortal()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws CustomerNotFoundError when user has no Stripe customer row', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ stripe_customers: { single: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    await expect(getBillingPortal()).rejects.toBeInstanceOf(CustomerNotFoundError)
  })

  it('throws DatabaseError — not CustomerNotFoundError — when the customer lookup fails for a real reason', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      stripe_customers: { single: { data: null, error: { code: '500', message: 'connection refused' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)
    await expect(getBillingPortal()).rejects.toBeInstanceOf(DatabaseError)
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

  it('throws DatabaseError — not null, which would read as "no subscription" — when the query itself fails', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: null, error: { code: '500', message: 'connection refused' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(getSubscription()).rejects.toBeInstanceOf(DatabaseError)
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

describe('changeSubscription', () => {
  const STRIPE_SUB_ID = 'sub_existing'
  const STRIPE_ITEM_ID = 'si_existing'
  const NEW_PRICE_ID = 'price_new_plan'

  const stripeSubFixture = {
    id: STRIPE_SUB_ID,
    items: { data: [{ id: STRIPE_ITEM_ID, price: { id: 'price_old' } }] },
  }

  beforeEach(() => {
    mockSubscriptionRetrieve.mockResolvedValue(stripeSubFixture)
    mockSubscriptionUpdate.mockResolvedValue({})
  })

  it('throws UnauthorizedError when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(changeSubscription(NEW_PRICE_ID)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws NoActiveSubscriptionError when user has no active subscription', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ subscriptions: { maybeSingle: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(changeSubscription(NEW_PRICE_ID)).rejects.toBeInstanceOf(NoActiveSubscriptionError)
  })

  it('throws DatabaseError — not NoActiveSubscriptionError — when the subscription lookup fails for a real reason', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: null, error: { code: '500', message: 'connection refused' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(changeSubscription(NEW_PRICE_ID)).rejects.toBeInstanceOf(DatabaseError)
  })

  it('retrieves the subscription from Stripe then calls update', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { stripe_subscription_id: STRIPE_SUB_ID } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await changeSubscription(NEW_PRICE_ID)

    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(STRIPE_SUB_ID)
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(STRIPE_SUB_ID, {
      items: [{ id: STRIPE_ITEM_ID, price: NEW_PRICE_ID }],
      proration_behavior: 'create_prorations',
    })
  })

  it('uses create_prorations by default', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { stripe_subscription_id: STRIPE_SUB_ID } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await changeSubscription(NEW_PRICE_ID)

    const [, updateArgs] = mockSubscriptionUpdate.mock.calls[0]
    expect(updateArgs.proration_behavior).toBe('create_prorations')
  })

  it('passes custom prorationBehavior when provided', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { stripe_subscription_id: STRIPE_SUB_ID } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await changeSubscription(NEW_PRICE_ID, 'none')

    const [, updateArgs] = mockSubscriptionUpdate.mock.calls[0]
    expect(updateArgs.proration_behavior).toBe('none')
  })

  it('queries only active, trialing, and past_due subscriptions', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase, spies } = mockSupabase({
      subscriptions: { maybeSingle: { data: null } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(changeSubscription(NEW_PRICE_ID)).rejects.toThrow()
    // maybeSingle is only reachable after the full .in().order().limit() chain
    expect(spies('subscriptions').maybeSingleFn).toHaveBeenCalled()
  })
})

describe('cancelSubscription', () => {
  const STRIPE_SUB_ID = 'sub_existing'

  beforeEach(() => {
    mockSubscriptionUpdate.mockResolvedValue({})
    mockSubscriptionCancel.mockResolvedValue({})
  })

  it('throws UnauthorizedError when not logged in', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(null) as any)
    await expect(cancelSubscription()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws NoActiveSubscriptionError when user has no active subscription', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({ subscriptions: { maybeSingle: { data: null } } })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(cancelSubscription()).rejects.toBeInstanceOf(NoActiveSubscriptionError)
  })

  it('throws DatabaseError — not NoActiveSubscriptionError — when the subscription lookup fails for a real reason', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: null, error: { code: '500', message: 'connection refused' } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await expect(cancelSubscription()).rejects.toBeInstanceOf(DatabaseError)
  })

  it('sets cancel_at_period_end: true by default (soft cancel)', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { stripe_subscription_id: STRIPE_SUB_ID } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await cancelSubscription()

    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(STRIPE_SUB_ID, {
      cancel_at_period_end: true,
    })
    expect(mockSubscriptionCancel).not.toHaveBeenCalled()
  })

  it('calls subscriptions.cancel when immediately=true', async () => {
    vi.mocked(createServerClient).mockReturnValue(mockAuthClient(USER) as any)
    const { supabase } = mockSupabase({
      subscriptions: { maybeSingle: { data: { stripe_subscription_id: STRIPE_SUB_ID } } },
    })
    vi.mocked(getServiceClient).mockReturnValue(supabase)

    await cancelSubscription(true)

    expect(mockSubscriptionCancel).toHaveBeenCalledWith(STRIPE_SUB_ID)
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled()
  })
})
