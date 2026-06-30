import { createClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}

export default async function Nav() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <nav>
      <div className="container inner">
        <a href="/" className="logo">@liveedevteam/<span>stripe</span> demo</a>
        <div className="nav-links">
          <a href="/pricing" className="btn btn-sm btn-secondary">Pricing</a>
          {user ? (
            <>
              <a href="/dashboard" className="btn btn-sm btn-secondary">Dashboard</a>
              <form action={signOut}>
                <button type="submit" className="btn btn-sm btn-secondary">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <a href="/login" className="btn btn-sm btn-secondary">Log in</a>
              <a href="/signup" className="btn btn-sm btn-primary">Sign up</a>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
