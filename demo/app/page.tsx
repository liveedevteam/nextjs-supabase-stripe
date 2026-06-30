import Nav from './nav'

export default function Home() {
  return (
    <>
      <Nav />
      <div className="container">
        <div className="hero">
          <div className="code-badge">pnpm add @liveedevteam/stripe</div>
          <h1>Stripe billing for<br /><span>Next.js + Supabase</span></h1>
          <p>
            One-time payments, subscriptions, webhooks, and server actions —
            production-ready in minutes.
          </p>
          <div className="hero-actions">
            <a href="/signup" className="btn btn-primary">Get started free</a>
            <a href="/pricing" className="btn btn-secondary">View pricing</a>
          </div>
        </div>
      </div>
    </>
  )
}
