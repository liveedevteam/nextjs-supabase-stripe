type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid'
  | 'paused'

/**
 * Database schema for the tables owned by this package.
 *
 * Pass this to createClient<Database>() in your Supabase client to get
 * type-checked queries for the billing tables. If you have other tables,
 * merge this with your own generated types:
 *
 * @example
 * import type { Database as BillingDB } from 'nextjs-supabase-stripe/types'
 * type Database = BillingDB & { public: { Tables: { ...yourTables } } }
 */
export type Database = {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string
          user_id: string | null
          stripe_session_id: string
          amount: number
          currency: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          stripe_session_id: string
          amount: number
          currency?: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          stripe_session_id?: string
          amount?: number
          currency?: string
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          user_id: string
          stripe_customer_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          stripe_customer_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          stripe_customer_id?: string
          created_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          stripe_subscription_id: string
          stripe_price_id: string
          status: SubscriptionStatus
          current_period_start: string
          current_period_end: string
          cancel_at_period_end: boolean
          cancel_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          stripe_subscription_id: string
          stripe_price_id: string
          status: SubscriptionStatus
          current_period_start: string
          current_period_end: string
          cancel_at_period_end?: boolean
          cancel_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          stripe_subscription_id?: string
          stripe_price_id?: string
          status?: SubscriptionStatus
          current_period_start?: string
          current_period_end?: string
          cancel_at_period_end?: boolean
          cancel_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          id: string
          type: string
          created_at: string
        }
        Insert: {
          id: string
          type: string
          created_at?: string
        }
        Update: {
          id?: string
          type?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    // Use empty mapped type so Supabase's GenericSchema constraint is satisfied
    // without a string index signature that would poison column type lookups
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
