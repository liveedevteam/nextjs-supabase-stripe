'use client'

import { getBillingPortal } from '@liveedevteam/stripe/actions'

export default function PortalButton() {
  return (
    <form action={getBillingPortal}>
      <button type="submit" className="btn btn-secondary">
        Manage billing
      </button>
    </form>
  )
}
