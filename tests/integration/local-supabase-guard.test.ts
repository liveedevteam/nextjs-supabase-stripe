import { describe, it, expect } from 'vitest'
import { isLocalSupabaseUrl } from './setup.js'

// Pure logic, no live Supabase needed — runs as part of the fast unit suite
// (see vitest.config.ts), not the local-stack integration suite.
describe('isLocalSupabaseUrl', () => {
  it('matches localhost URLs', () => {
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true)
  })

  it('matches 127.0.0.1 URLs — the format supabase status --output env actually returns', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true)
  })

  it('matches with a trailing path', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321/rest/v1')).toBe(true)
  })

  it('rejects a hosted Supabase project URL', () => {
    expect(isLocalSupabaseUrl('https://myproject.supabase.co')).toBe(false)
  })

  it('rejects a lookalike host that merely contains "localhost"', () => {
    expect(isLocalSupabaseUrl('http://localhost.evil.com')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isLocalSupabaseUrl(undefined)).toBe(false)
  })
})
