import Nav from '../nav'
import CheckoutButton from './checkout-button'

const PRICE_PRO = process.env.NEXT_PUBLIC_PRICE_PRO!
const PRICE_ENTERPRISE = process.env.NEXT_PUBLIC_PRICE_ENTERPRISE!

export default function PricingPage() {
  return (
    <>
      <Nav />
      <div className="container">
        <div className="hero" style={{ paddingBottom: 0 }}>
          <h1>Simple, transparent <span>pricing</span></h1>
          <p>Start free, upgrade when you need more. Cancel anytime.</p>
        </div>

        <div className="pricing-grid">
          {/* Pro */}
          <div className="pricing-card">
            <div>
              <h2>Pro</h2>
              <div className="price">$9<span>/mo</span></div>
            </div>
            <ul>
              <li>Up to 5 projects</li>
              <li>10 GB storage</li>
              <li>Priority email support</li>
              <li>API access</li>
            </ul>
            <CheckoutButton priceId={PRICE_PRO} label="Get started with Pro" />
          </div>

          {/* Enterprise */}
          <div className="pricing-card featured" style={{ position: 'relative' }}>
            <div className="badge">Most popular</div>
            <div>
              <h2>Enterprise</h2>
              <div className="price">$29<span>/mo</span></div>
            </div>
            <ul>
              <li>Unlimited projects</li>
              <li>100 GB storage</li>
              <li>24/7 dedicated support</li>
              <li>API access + webhooks</li>
              <li>SSO & audit logs</li>
            </ul>
            <CheckoutButton priceId={PRICE_ENTERPRISE} label="Get started with Enterprise" featured />
          </div>
        </div>

        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.85rem', paddingBottom: 48 }}>
          Payments handled securely by Stripe. This is a demo — use card <strong>4242 4242 4242 4242</strong>.
        </p>
      </div>
    </>
  )
}
