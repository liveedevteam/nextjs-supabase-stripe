import { requireActiveSubscription, getSubscription } from '@liveedevteam/stripe/actions'
import Nav from '../nav'
import PortalButton from './portal-button'
import CancelButton from './cancel-button'

function statusClass(status: string) {
  if (status === 'active') return 'status-badge status-active'
  if (status === 'trialing') return 'status-badge status-trialing'
  return 'status-badge status-past_due'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function DashboardPage() {
  await requireActiveSubscription()
  const sub = await getSubscription()

  return (
    <>
      <Nav />
      <div className="container page">
        <h1>Dashboard</h1>
        <p className="subtitle">Your current subscription and billing details.</p>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="label">Status</div>
            <div className="value">
              <span className={statusClass(sub!.status)}>{sub!.status}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Current period ends</div>
            <div className="value">{formatDate(sub!.current_period_end)}</div>
          </div>
          <div className="stat-card">
            <div className="label">Cancel at period end</div>
            <div className="value">{sub!.cancel_at_period_end ? 'Yes' : 'No'}</div>
          </div>
          <div className="stat-card">
            <div className="label">Price ID</div>
            <div className="value" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
              {sub!.stripe_price_id}
            </div>
          </div>
        </div>

        <div className="action-row">
          <PortalButton />
          <a href="/pricing" className="btn btn-secondary">Change plan</a>
          {!sub!.cancel_at_period_end && <CancelButton />}
        </div>

        {sub!.cancel_at_period_end && (
          <p style={{ marginTop: 20, color: '#dc2626', fontSize: '0.9rem' }}>
            Your subscription will cancel on {formatDate(sub!.current_period_end)}.
            Visit the billing portal to reactivate.
          </p>
        )}
      </div>
    </>
  )
}
