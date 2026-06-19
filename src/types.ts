export type Subscription = {
  id: string
  user_id: string
  stripe_subscription_id: string
  stripe_price_id: string
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid' | 'paused'
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  cancel_at: string | null
  created_at: string
}
