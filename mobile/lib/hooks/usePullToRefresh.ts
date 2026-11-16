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
 * one pull). `allSettled`, so one failing shelf can't leave the spinner stuck, and the
 * spinner stops even if the screen unmounts mid-refresh. Gold, like every other progress
 * mark in the app.
 *
 * Spread it straight onto RN's own `RefreshControl` (`<RefreshControl {...ptr} />`) —
 * Android's `ScrollView` clones that exact element around its content, so it can't be
 * wrapped in a custom component.
 */
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
    void Promise.allSettled(
      sourcesRef.current.map((source) => (typeof source === 'function' ? source() : source.refetch())),
    ).finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, []);

  return { refreshing, onRefresh, tintColor: colors.accent.gold, colors: [colors.accent.gold] };
}
