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
 * Nothing pages-related renders until that `onLayout` width actually lands (fixed
 * 2026-10-16, Isaac's report: the hero's art appeared to "grow, then snap back" between
 * a cold Home mount and a later revisit). The ScrollView/pages used to fall back to a
 * CSS `width: '100%'` for the one render before `onLayout` fired — percentage width on a
 * horizontal ScrollView's *paged* content is a known RN/Yoga gray area (the content
 * container's own main-axis size is itself intrinsic/shrink-to-fit, so a child's "100%"
 * of it is circular), and it resolved inconsistently between a cold mount and a later
 * remount (`(tabs)` has no persistent tab navigator under `Slot` — leaving and returning
 * to Home fully unmounts and remounts this component, and on a remount `useHeroSermons`
 * usually serves cached data synchronously, so that one-bad-frame render is far more
 * likely to actually paint than on a cold mount, where the hero sits behind a loading
 * skeleton for the whole first render anyway). `HeroCard`'s own art region uses a fixed
 * `aspectRatio`, so an indeterminate *width* is what was producing a differently-cropped
 * *height* — not a one-off glitch, a genuinely different pixel width computed each time.
 * The fix: render nothing inside `wrap` until `onLayout` reports a real pixel width, then
 * give every page that exact width — never a guess.
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
                <HeroCard sermon={sermon} onPress={() => onPress(sermon.id)} topInset={topInset} />
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
