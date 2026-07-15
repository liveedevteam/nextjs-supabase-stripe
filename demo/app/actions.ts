'use server'

import { createCheckout as _createCheckout } from 'nextjs-supabase-stripe/actions'
import { redirect } from 'next/navigation'

export async function createCheckout(priceId: string, mode: 'subscription' | 'payment') {
  try {
    await _createCheckout(priceId, mode)
  } catch (e: any) {
    // redirect() throws internally — re-throw it
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
    if (e?.message === 'Unauthorized') redirect('/login')
    console.error('[createCheckout] error:', e?.message, e?.type, e?.statusCode)
    throw e
  }
}
