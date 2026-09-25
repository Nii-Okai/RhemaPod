import { useEffect, useState } from 'react';

/**
 * Generic trailing-edge debounce — `value` only propagates once `delayMs`
 * has passed without a further change. Hand-written rather than a dependency
 * per plan W4.3 ("hand-write the debounce hook"): the whole implementation
 * is a `setTimeout`/`clearTimeout` pair, not worth a package.
 *
 * `/search/suggest` (search.tsx) is the concrete reason this exists: an
 * undebounced suggest box would fire a request per keystroke and
 * self-throttle against the per-user rate limiter (plan L14) before a real
 * user even finishes typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
