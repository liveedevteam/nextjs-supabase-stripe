/**
 * Typed errors thrown by this package's server actions and clients.
 * Prefer `instanceof` checks over matching on `error.message`.
 *
 * @example
 * try {
 *   await createCheckout(priceId, 'subscription')
 * } catch (e) {
 *   if (e instanceof UnauthorizedError) redirect('/login')
 *   throw e
 * }
 */

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super('No Stripe customer found for this user')
    this.name = 'CustomerNotFoundError'
  }
}

export class NoActiveSubscriptionError extends Error {
  constructor() {
    super('No active subscription found')
    this.name = 'NoActiveSubscriptionError'
  }
}

/**
 * Thrown by getStripeClient()/getServiceClient() and the webhook handler
 * when required environment variables are missing. Lists every missing
 * variable for that feature in one error instead of failing on the first.
 */
export class MissingEnvironmentVariableError extends Error {
  constructor(feature: string, missing: string[]) {
    super(
      `${feature} requires the following environment variable(s), which ${missing.length === 1 ? 'is' : 'are'} missing: ${missing.join(', ')}. See README.md → "Environment variables required".`
    )
    this.name = 'MissingEnvironmentVariableError'
  }
}

/** Thrown when NEXT_PUBLIC_APP_URL is unset or not a valid absolute URL. */
export class InvalidRedirectUrlError extends Error {
  constructor(value: string | undefined) {
    super(
      `NEXT_PUBLIC_APP_URL is not a valid absolute URL (got: ${JSON.stringify(value)}). Set it to e.g. "https://example.com" in your environment.`
    )
    this.name = 'InvalidRedirectUrlError'
  }
}

/**
 * Thrown instead of silently treating a database failure as "not found".
 * A `.single()`/`.maybeSingle()` call returning no rows is not an error —
 * this wraps genuine Supabase errors (network, permissions, etc.) only.
 */
export class DatabaseError extends Error {
  constructor(operation: string, cause: { message: string; code?: string }) {
    super(`Database error during ${operation}: ${cause.message}`)
    this.name = 'DatabaseError'
  }
}
