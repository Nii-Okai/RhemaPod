import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';
import { HeroCard } from './HeroCard';

export interface HeroCarouselProps {
  sermons: SermonListItem[];
  onPress: (id: string) => void;
  /** Forwarded to every `HeroCard` — clears the overlaid, scroll-fading `HomeTopBar`
      (Isaac's ask, session 2026-09-30). See `HeroCard`'s own `topInset` doc comment. */
  topInset?: number;
}

const AUTO_ADVANCE_MS = 6000;

/**
 * Home's hero (Isaac's ask, session 2026-09-30: 3 items instead of 1, auto-scrolling —
 * Prime Video/Disney+'s rotating-hero pattern). Backed by `useHeroSermons` (`GET
 * .../sermons/hero`), which is already capped to one sermon per series, so this
 * component itself does no deduping — it just pages through whatever it's given.
 *
 * Page width comes from `onLayout`, not `Dimensions.get('window')` — the carousel sits
 * inside Home's own padded content column, not the full screen width, and a
 * `Dimensions`-based width would page past the visible card.
 *
 * Every layer here (the outer wrap, the ScrollView, each page) carries the same dark
 * `colors.surface.app` background as the screen itself — `HeroCard`'s own rounded
 * corners (`radius.sm`, tightened from `radius.xl` session 2026-10-01 to match Isaac's
 * Netflix reference — every home card now shares this same subtle radius) otherwise
 * expose a sliver of whatever's *behind* the card at
 * each corner during a drag, and an unstyled `ScrollView` renders that as iOS's default
 * white, not transparent (Isaac's report, session 2026-09-30: "white line on the right
 * when scrolling").
 *
 * Auto-advances every 6s, pausing while the user is actively dragging (`draggingRef`)
 * so it never fights a manual swipe — picks back up on the next tick afterward rather
 * than needing an explicit "resume" timer.
 *
 * Falls back to a single plain `HeroCard` (no scroll machinery, no dots, no
 * auto-advance) when there's only one sermon — a one-item "carousel" has nothing to
 * page between.
 */
export function HeroCarousel({ sermons, onPress, topInset = 0 }: HeroCarouselProps) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const draggingRef = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    draggingRef.current = false;
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  useEffect(() => {
    if (sermons.length <= 1 || !width) return;
    const id = setInterval(() => {
      if (draggingRef.current) return;
      setPage((current) => {
        const next = (current + 1) % sermons.length;
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [sermons.length, width]);

  if (sermons.length <= 1) {
    const only = sermons[0];
    return only ? <HeroCard sermon={only} onPress={() => onPress(only.id)} topInset={topInset} /> : null;
  }

  return (
    <View testID="hero-carousel" onLayout={onLayout} style={styles.wrap}>
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
          <View key={sermon.id} style={[styles.page, width ? { width } : styles.pageFallback]}>
            <HeroCard sermon={sermon} onPress={() => onPress(sermon.id)} topInset={topInset} />
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {sermons.map((sermon, index) => (
          <View key={sermon.id} style={[styles.dot, index === page && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface.app,
  },
  scrollView: {
    backgroundColor: colors.surface.app,
  },
  page: {
    backgroundColor: colors.surface.app,
  },
  pageFallback: {
    width: '100%',
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
});
