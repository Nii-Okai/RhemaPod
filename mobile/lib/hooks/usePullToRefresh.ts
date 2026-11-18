import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext';

/** Anything with a TanStack-style `refetch` — a query result, or a bare function. */
type Refetchable = { refetch: () => Promise<unknown> } | (() => Promise<unknown>);

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  tintColor: string;
  colors: string[];
}

/**
 * Props for a screen's `<RefreshControl>`: refetches exactly the reads that screen shows
 * (never every active query — tabs stay mounted, so that would refetch the whole app on
 * one pull). Every source is waited on whether it succeeds or fails, so one failing shelf
 * can't leave the spinner stuck, and the spinner stops even if the screen unmounts
 * mid-refresh. Gold, like every other progress
 * mark in the app.
 *
 * Spread it straight onto RN's own `RefreshControl` (`<RefreshControl {...ptr} />`) —
 * Android's `ScrollView` clones that exact element around its content, so it can't be
 * wrapped in a custom component.
 */
/**
 * Refetches one source and resolves once it is done, whether it succeeded or failed.
 *
 * Not `Promise.allSettled`: Hermes's built-in Promise in this React Native version doesn't
 * have it, so calling it threw "undefined is not a function" and closed the app on every
 * pull to refresh on Android (Sentry RHEMAPOD-MOBILE-1).
 */
function settle(source: Refetchable): Promise<void> {
  try {
    const pending = typeof source === 'function' ? source() : source.refetch();
    return Promise.resolve(pending).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

export function usePullToRefresh(sources: Refetchable[]): PullToRefreshProps {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all(sourcesRef.current.map(settle)).then(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, []);

  return { refreshing, onRefresh, tintColor: colors.accent.gold, colors: [colors.accent.gold] };
}
