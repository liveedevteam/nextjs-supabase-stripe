import Stripe from 'stripe'

let instance: Stripe | null = null

export const getStripeClient = () => {
  if (!instance) {
    instance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
      typescript: true,
    })
  }
  return instance
}
