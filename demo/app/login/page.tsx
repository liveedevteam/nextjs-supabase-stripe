import { createClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  async function login(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
    redirect('/dashboard')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Welcome back</h1>
        <p className="sub">Sign in to your account</p>

        {/* @ts-expect-error searchParams is a Promise in Next 15 */}
        {searchParams?.error && (
          // @ts-expect-error
          <div className="error-msg">{decodeURIComponent(searchParams.error)}</div>
        )}

        <form action={login}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required placeholder="••••••••" />
          </div>
          <button type="submit" className="btn btn-primary btn-full">Sign in</button>
        </form>
        <div className="form-footer">
          Don't have an account? <a href="/signup">Sign up</a>
        </div>
      </div>
    </div>
  )
}
