import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useReduceMotion } from '../../../lib/hooks/useReduceMotion';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';
import { HeroCard } from './HeroCard';

export interface HeroCarouselProps {
  sermons: SermonListItem[];
  onPress: (id: string) => void;
  /** Forwarded to every `HeroCard` — clears the overlaid, scroll-fading `HomeTopBar`
      See `HeroCard`'s own `topInset` doc comment. */
  topInset?: number;
  /** Draws each page instead of the classic `HeroCard` — Signature Home's own hero card
      reuses this paging/auto-advance machinery rather than duplicating it. */
  renderCard?: (sermon: SermonListItem, onPress: () => void) => ReactNode;
}

const AUTO_ADVANCE_MS = 6000;

/**
 * Home's hero: up to 3 sermons, auto-scrolling (the rotating-hero pattern of streaming
 * apps). Backed by `useHeroSermons` (`GET
 * .../sermons/hero`), which is already capped to one sermon per series, so this
 * component itself does no deduping — it just pages through whatever it's given.
 *
 * Page width comes from `onLayout`, not `Dimensions.get('window')` — the carousel sits
 * inside Home's own padded content column, not the full screen width, and a
 * `Dimensions`-based width would page past the visible card.
 *
 * Nothing pages-related renders until that `onLayout` width actually lands, and every
 * page then gets that exact pixel width. A CSS `width: '100%'` fallback for the first
 * render doesn't work: percentage width on a horizontal ScrollView's *paged* content is
 * a known RN/Yoga gray area (the content container's main-axis size is itself
 * shrink-to-fit, so a child's "100%" of it is circular) and resolves differently between
 * mounts. Home remounts this component on every visit (`(tabs)` has no persistent tab
 * navigator under `Slot`) and usually has cached data on a remount, so that first frame
 * paints; with `HeroCard`'s fixed `aspectRatio`, a different width means a visibly
 * different art height ("grow, then snap back").
 *
 * Every layer here (the outer wrap, the ScrollView, each page) carries the same dark
 * `colors.surface.app` background as the screen itself — `HeroCard`'s own rounded
 * corners (`radius.sm`, the radius every home card shares) otherwise expose a sliver of
 * whatever's *behind* the card at each corner during a drag, and an unstyled `ScrollView`
 * renders that as iOS's default white, not transparent (a white line on the right while
 * scrolling).
 *
 * Auto-advances every 6s, pausing while the user is actively dragging (`draggingRef`)
 * so it never fights a manual swipe — picks back up on the next tick afterward rather
 * than needing an explicit "resume" timer. With Reduce Motion on it doesn't auto-advance
 * at all: the listener swipes between sermons themselves.
 *
 * Falls back to a single plain `HeroCard` (no scroll machinery, no dots, no
 * auto-advance) when there's only one sermon — a one-item "carousel" has nothing to
 * page between.
 */
export function HeroCarousel({ sermons, onPress, topInset = 0, renderCard }: HeroCarouselProps) {
  const card = (sermon: SermonListItem) =>
    renderCard ? (
      renderCard(sermon, () => onPress(sermon.id))
    ) : (
      <HeroCard sermon={sermon} onPress={() => onPress(sermon.id)} topInset={topInset} />
    );
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const draggingRef = useRef(false);
  const reduceMotion = useReduceMotion();

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    draggingRef.current = false;
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  useEffect(() => {
    if (sermons.length <= 1 || !width || reduceMotion) return;
    const id = setInterval(() => {
      if (draggingRef.current) return;
      setPage((current) => {
        const next = (current + 1) % sermons.length;
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [sermons.length, width, reduceMotion]);

  if (sermons.length <= 1) {
    const only = sermons[0];
    return only ? <>{card(only)}</> : null;
  }

  return (
    <View testID="hero-carousel" onLayout={onLayout} style={styles.wrap}>
      {width ? (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.scrollView}
            onScrollBeginDrag={() => {
              draggingRef.current = true;
            }}
            onScrollEndDrag={() => {
              draggingRef.current = false;
            }}
            onMomentumScrollEnd={onMomentumScrollEnd}
            accessibilityLabel={`Featured sermons, ${page + 1} of ${sermons.length}`}
          >
            {sermons.map((sermon) => (
              <View key={sermon.id} style={[styles.page, { width }]}>
                {card(sermon)}
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots} pointerEvents="none">
            {sermons.map((sermon, index) => (
              <View key={sermon.id} style={[styles.dot, index === page && styles.dotActive]} />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surface.app,
  },
  scrollView: {
    backgroundColor: colors.surface.app,
  },
  page: {
    backgroundColor: colors.surface.app,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border.default,
  },
  dotActive: {
    backgroundColor: colors.accent.gold,
    width: 16,
  },
}));
