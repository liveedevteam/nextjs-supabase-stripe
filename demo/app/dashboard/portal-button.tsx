'use client'

import { getBillingPortal } from 'nextjs-supabase-stripe/actions'

export default function PortalButton() {
  return (
    <form action={getBillingPortal}>
      <button type="submit" className="btn btn-secondary">
        Manage billing
      </button>
    </form>
  )
}
