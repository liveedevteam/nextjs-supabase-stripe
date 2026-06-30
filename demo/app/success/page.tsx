export default function SuccessPage() {
  return (
    <div className="success-wrap">
      <div>
        <div className="icon">🎉</div>
        <h1>You're subscribed!</h1>
        <p>Your payment was successful. Welcome aboard.</p>
        <a href="/dashboard" className="btn btn-primary">Go to dashboard</a>
      </div>
    </div>
  )
}
