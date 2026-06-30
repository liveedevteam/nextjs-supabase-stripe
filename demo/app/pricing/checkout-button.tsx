'use client'

import { createCheckout } from '@liveedevteam/stripe/actions'

export default function CheckoutButton({
  priceId,
  label,
  featured,
}: {
  priceId: string
  label: string
  featured?: boolean
}) {
  return (
    <form action={() => createCheckout(priceId, 'subscription')}>
      <button
        type="submit"
        className={`btn btn-full ${featured ? 'btn-primary' : 'btn-secondary'}`}
      >
        {label}
      </button>
    </form>
  )
}
