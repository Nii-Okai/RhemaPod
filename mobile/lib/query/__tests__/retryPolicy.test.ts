/**
 * W3.3 verification: "a test proving a 429 doesn't trigger a retry storm."
 * Also covers `shouldRetry`/`retryDelay`'s other error classes (§A.8) since
 * they're the same small policy and a happy-path-only test would miss a
 * regression in, say, the "don't retry a 404" branch.
 */
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { ApiError, networkError } from '../../api/errors';
import { retryDelay, shouldRetry } from '../retryPolicy';

function rateLimitError(retryAfterSeconds: string): ApiError {
  const err = new ApiError(429, 'Too many requests. Try again shortly.');
  err.retryAfter = retryAfterSeconds;
  return err;
}

describe('shouldRetry', () => {
  it('caps a 429 at exactly one retry, regardless of how many times TanStack Query asks', () => {
    const err = rateLimitError('5');
    // TanStack Query calls `retry(failureCount, error)` with the count of
    // failures *so far*, asking each time whether to try again.
    expect(shouldRetry(0, err)).toBe(true); // 1st failure -> one retry allowed
    expect(shouldRetry(1, err)).toBe(false); // 2nd failure -> no retry storm
    expect(shouldRetry(2, err)).toBe(false);
    expect(shouldRetry(10, err)).toBe(false);
  });

  it('retries a network failure a bounded number of times', () => {
    const err = networkError();
    expect(shouldRetry(0, err)).toBe(true);
    expect(shouldRetry(1, err)).toBe(true);
    expect(shouldRetry(2, err)).toBe(false);
  });

  it('retries a 5xx a bounded number of times', () => {
    const err = new ApiError(503, 'Service unavailable');
    expect(shouldRetry(0, err)).toBe(true);
    expect(shouldRetry(1, err)).toBe(true);
    expect(shouldRetry(2, err)).toBe(false);
  });

  it('never retries a non-429, non-5xx client error (e.g. 404)', () => {
    const err = new ApiError(404, 'Not found');
    expect(shouldRetry(0, err)).toBe(false);
  });

  it('never retries a 403', () => {
    const err = new ApiError(403, 'Forbidden');
    expect(shouldRetry(0, err)).toBe(false);
  });

  it('does not retry an error that is not an ApiError at all', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
  });
});

describe('retryDelay', () => {
  it('honors the backend-supplied Retry-After header on a 429, in milliseconds', () => {
    expect(retryDelay(0, rateLimitError('5'))).toBe(5000);
    expect(retryDelay(0, rateLimitError('30'))).toBe(30000);
  });

  it('falls back to exponential backoff on a 429 with no Retry-After header', () => {
    const err = new ApiError(429, 'Too many requests.');
    err.retryAfter = null;
    expect(retryDelay(0, err)).toBe(1000);
    expect(retryDelay(1, err)).toBe(2000);
  });

  it('ignores a garbage Retry-After value rather than waiting NaN ms', () => {
    const err = rateLimitError('not-a-number');
    expect(retryDelay(0, err)).toBe(1000);
  });

  it('uses capped exponential backoff for a network failure', () => {
    const err = networkError();
    expect(retryDelay(0, err)).toBe(1000);
    expect(retryDelay(1, err)).toBe(2000);
    expect(retryDelay(2, err)).toBe(4000);
  });
});

describe('wired into a real QueryClient (not just the pure functions)', () => {
  it('a persistent 429 produces exactly one retry, not a storm', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetry, retryDelay } },
    });
    // A short-but-real Retry-After so the test exercises TanStack Query's
    // actual retry scheduler (not a mock of it) without a multi-second
    // sleep.
    const err = rateLimitError('0.05');
    const queryFn = jest.fn().mockRejectedValue(err);

    await expect(client.fetchQuery({ queryKey: ['rate-limited-probe'], queryFn })).rejects.toThrow(err);

    // The original attempt plus exactly the one retry `shouldRetry` allows
    // for a 429 — never an unbounded loop hammering the same bucket.
    expect(queryFn).toHaveBeenCalledTimes(2);

    // `QueryClient` schedules a `gcTime` timeout per query; clear it so
    // Jest doesn't report an open handle after this test completes.
    client.clear();
  });
});

describe('shouldRetry while offline', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('never retries a network failure once the device is known to be offline', () => {
    onlineManager.setOnline(false);
    expect(shouldRetry(0, networkError())).toBe(false);
  });

  it('keeps the 5xx rule unchanged while offline', () => {
    onlineManager.setOnline(false);
    expect(shouldRetry(0, new ApiError(503, 'Unavailable'))).toBe(true);
  });
});
