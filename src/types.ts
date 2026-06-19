import type { Database } from './database.types.js'

// Derived from the Database schema so it stays in sync automatically
export type Subscription = Database['public']['Tables']['subscriptions']['Row']

export type { Database }
