import { createClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  async function signup(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { error } = await supabase.auth.signUp({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`)
    redirect('/pricing')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Create an account</h1>
        <p className="sub">Start your free trial today</p>

        {/* @ts-expect-error searchParams is a Promise in Next 15 */}
        {searchParams?.error && (
          // @ts-expect-error
          <div className="error-msg">{decodeURIComponent(searchParams.error)}</div>
        )}

        <form action={signup}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required placeholder="Min 6 characters" />
          </div>
          <button type="submit" className="btn btn-primary btn-full">Create account</button>
        </form>
        <div className="form-footer">
          Already have an account? <a href="/login">Sign in</a>
        </div>
      </div>
    </div>
  )
}
