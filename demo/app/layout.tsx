import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'nextjs-supabase-stripe — Demo',
  description: 'Stripe + Next.js + Supabase integration demo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
