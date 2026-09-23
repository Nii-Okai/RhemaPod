import { ApiError } from '../api/errors';

/**
 * TanStack Query's own default (`retry: 3`, exponential backoff with no
 * ceiling on the exponent) is tuned for a web app hitting a backend with no
 * per-user rate limiter. This app has one (W2.1, `app/core/middleware.py`'s
 * `RateLimitMiddleware`) — a query that retries blindly into a 429 just
 * re-triggers the same bucket and manufactures the exact retry storm the
 * limiter exists to prevent. `shouldRetry`/`retryDelay` below are the pair
 * TanStack Query expects for `defaultOptions.queries.retry` /
 * `.retryDelay`, and are deliberately asymmetric by error class:
 *
 *  - Network failure (`ApiError.network`, `lib/api/errors.ts` — the request
 *    never reached the server): retried a couple of times with exponential
 *    backoff. Mobile networks blip; a query that gives up on the first
 *    dropped packet is worse than one that tries again in a second.
 *  - 429: retried **at most once**, and only after waiting out the
 *    backend's own `Retry-After` header (seconds, `middleware.py`'s
 *    `ceil(60 / refill_per_minute)`) — never TanStack's own exponential
 *    schedule, which has no idea how long the bucket actually needs to
 *    refill. One retry, not zero, because a single 429 during a burst
 *    (e.g. a cold Home screen firing several queries at once) is expected
 *    and self-corrects once the bucket refills; the cap exists so a bucket
 *    that stays exhausted doesn't turn one query into an unbounded loop.
 *  - Any other 4xx (401 is already handled inside `apiFetch` itself via
 *    single-flight refresh-and-retry before this policy ever sees it; this
 *    covers 400/403/404/422/etc.): never retried — the request is wrong,
 *    not unlucky, and retrying won't change that.
 *  - 5xx: retried like a network failure — the server is having a bad
 *    moment, not rejecting the request on principle.
 */
const MAX_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 1;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    // Not our envelope — a programming error (bad query fn, etc.), not a
    // transient condition. Don't mask it behind a retry loop.
    return false;
  }
  if (error.network) return failureCount < MAX_RETRIES;
  if (error.status === 429) return failureCount < MAX_RATE_LIMIT_RETRIES;
  if (error.status >= 500) return failureCount < MAX_RETRIES;
  return false;
}

export function retryDelay(attemptIndex: number, error: unknown): number {
  if (error instanceof ApiError && error.status === 429 && error.retryAfter) {
    const seconds = Number(error.retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
}
