import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

type Result = { data?: any; error?: any }
type TableConfig = {
  single?: Result
  maybeSingle?: Result
  insert?: Result
  upsert?: Result
  update?: Result
  delete?: Result
}

export type TableSpies = {
  singleFn: ReturnType<typeof vi.fn>
  maybeSingleFn: ReturnType<typeof vi.fn>
  insertFn: ReturnType<typeof vi.fn>
  upsertFn: ReturnType<typeof vi.fn>
  updateFn: ReturnType<typeof vi.fn>
  updateEqFn: ReturnType<typeof vi.fn>
  deleteFn: ReturnType<typeof vi.fn>
  deleteEqFn: ReturnType<typeof vi.fn>
}

export function mockSupabase(config: Record<string, TableConfig> = {}) {
  const cache: Record<string, TableSpies & { builder: any }> = {}

  const getOrCreate = (table: string) => {
    if (cache[table]) return cache[table]
    const t = config[table] ?? {}

    const singleFn = vi.fn(() => Promise.resolve(t.single ?? { data: null, error: null }))
    const maybeSingleFn = vi.fn(() => Promise.resolve(t.maybeSingle ?? { data: null, error: null }))
    const insertFn = vi.fn(() => Promise.resolve({ error: t.insert?.error ?? null }))
    const upsertFn = vi.fn(() => Promise.resolve({ error: t.upsert?.error ?? null }))
    const updateEqFn = vi.fn(() => Promise.resolve({ error: t.update?.error ?? null }))
    const updateFn = vi.fn(() => ({ eq: updateEqFn }))
    const deleteEqFn = vi.fn(() => Promise.resolve({ error: t.delete?.error ?? null }))
    const deleteFn = vi.fn(() => ({ eq: deleteEqFn }))

    // Builds a chainable neq/in/order/limit object that terminates at maybeSingle
    const neqChain = (): any => ({
      neq: vi.fn(() => neqChain()),
      in: vi.fn(() => neqChain()),
      order: vi.fn(() => ({
        limit: vi.fn(() => ({ maybeSingle: maybeSingleFn })),
      })),
    })

    const builder = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: singleFn,
          neq: vi.fn(() => neqChain()),
          in: vi.fn(() => neqChain()),
        })),
      })),
      insert: insertFn,
      upsert: upsertFn,
      update: updateFn,
      delete: deleteFn,
    }

    cache[table] = { singleFn, maybeSingleFn, insertFn, upsertFn, updateFn, updateEqFn, deleteFn, deleteEqFn, builder }
    return cache[table]
  }

  const supabase = {
    from: vi.fn((table: string) => getOrCreate(table).builder),
  } as unknown as SupabaseClient

  // Returns the recorded spy functions for a given table for assertions
  const spies = (table: string): TableSpies => {
    const { builder: _b, ...rest } = getOrCreate(table)
    return rest
  }

  return { supabase, spies }
}
