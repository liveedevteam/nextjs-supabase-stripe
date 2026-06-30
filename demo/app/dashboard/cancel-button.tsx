'use client'

import { cancelSubscription } from '@liveedevteam/stripe/actions'
import { useTransition } from 'react'

export default function CancelButton() {
  const [pending, startTransition] = useTransition()

  return (
    <form
      action={() =>
        startTransition(async () => {
          if (!confirm('Cancel at end of billing period?')) return
          await cancelSubscription()
        })
      }
    >
      <button type="submit" className="btn btn-danger" disabled={pending}>
        {pending ? 'Cancelling…' : 'Cancel subscription'}
      </button>
    </form>
  )
}
