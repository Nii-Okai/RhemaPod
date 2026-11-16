import { useCallback, useEffect, useRef, useState } from 'react';

export interface MediaCacheUsage {
  /** Bytes the play-cache holds right now; `null` until the first read lands. */
  bytes: number | null;
  clearing: boolean;
  clear: () => Promise<void>;
}

export interface MediaCacheUsageDeps {
  totalBytes: () => Promise<number>;
  clear: () => Promise<void>;
}

function defaultDeps(): MediaCacheUsageDeps {
  // Required lazily, same as `lib/auth/session.ts`: the manifest opens expo-sqlite, which a
  // screen test rendering You shouldn't have to mock just to draw this one row.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const manifest = require('./manifest') as typeof import('./manifest');
  const { clearMediaCache } = require('./clearMediaCache') as typeof import('./clearMediaCache');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { totalBytes: manifest.totalBytes, clear: clearMediaCache };
}

/**
 * How much room the automatic play-cache (sermons partly played on Wi-Fi, kept so a
 * replay doesn't stream them again) is taking, and a way to give it back. Downloads the
 * user made are separate and untouched.
 */
export function useMediaCacheUsage(deps?: MediaCacheUsageDeps): MediaCacheUsage {
  const depsRef = useRef<MediaCacheUsageDeps | null>(deps ?? null);
  const resolve = () => {
    if (!depsRef.current) depsRef.current = defaultDeps();
    return depsRef.current;
  };
  const [bytes, setBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const total = await resolve().totalBytes();
      if (mounted.current) setBytes(total);
    } catch {
      if (mounted.current) setBytes(0);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const clear = useCallback(async () => {
    setClearing(true);
    try {
      await resolve().clear();
    } finally {
      await refresh();
      if (mounted.current) setClearing(false);
    }
  }, [refresh]);

  return { bytes, clearing, clear };
}

/** "0 MB", "12 MB", "1.2 GB" — settings-row precision, not a file manager's. */
export function formatCacheSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
