import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, LinkButton, PrimaryButton } from '../components';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { onboardingSlides } from '../lib/onboarding/slides';
import { markOnboardingSeen } from '../lib/settings/onboardingSeen';

// Experimental "make it alive" tuning (see the doc comment below) — tweak or delete freely.
const KEN_BURNS_DURATION_MS = 7000;
const KEN_BURNS_MAX_SCALE = 1.06;

/**
 * First-launch onboarding (Isaac's mockups: a 3-slide swipeable carousel shown only the
 * very first time the app is opened — before sign-in, before any account is known).
 * Gated by `app/index.tsx` via `lib/settings/onboardingSeen.ts`; reached directly, with
 * nothing rendered before it.
 *
 * "Configurable out of code": every slide's image/headline/body comes from
 * `lib/onboarding/slides.ts` — this screen just maps over that array. Changing the
 * copy or swapping in real photography later (replacing the current Isaac-provided
 * placeholder images) is a one-line edit to that data file, never a change here.
 *
 * Swipeable mechanism mirrors `(tabs)/_home/HeroCarousel.tsx` (the app's own proven
 * pattern, reused rather than a new carousel dependency): `onLayout` for page
 * dimensions (not `Dimensions.get('window')`, same reasoning — this screen is full-bleed
 * here, but tracking real layout is still the safer, already-established approach), a
 * paging `ScrollView`, `onMomentumScrollEnd` to settle the shared `page` index.
 *
 * Skip (top-right over the image), the pagination dots, and the Next/Get Started button
 * render identically on every slide — rather than pulling them out as a fixed overlay
 * above the `ScrollView`, each is rendered per-slide inside the generic `.map` (dots key
 * off the shared `page` state, the button's label/action off that slide's own index).
 * Simpler than coordinating a separate overlay's state with the scroll position, and
 * visually identical since only the current page's copy of each is ever on-screen.
 *
 * Skip and the final slide's "Get Started" both do the same thing: mark onboarding seen
 * and land on sign-in — onboarding is pre-auth, so it never routes straight into
 * `(tabs)` even if a session technically exists already.
 *
 * EXPERIMENTAL (Isaac's ask, 2026-10-16: "put some effects on the onboarding images to
 * make it alive") — may be reverted. A slow, continuous "Ken Burns" zoom on every slide's
 * image (shared loop, RN core `Animated`, same API this app already uses in
 * `StaggerItem`/`CircularProgress`/etc. — no new dependency), applied identically to all
 * three since only the current page is ever visible through the paging `ScrollView`
 * anyway. Deliberately ambient, not a transition: it runs continuously and isn't tied to
 * swiping or which slide is active — Isaac's explicit follow-up ask, same session: "do not
 * add transition effects" (an earlier pass here also had a scroll-tied image parallax and
 * a per-slide fade+rise-in on the text card, both removed for that reason).
 * `imageWrap` gained `overflow: 'hidden'` so the zoom never visibly escapes its panel; any
 * edge sliver reveals this screen's own navy background, not a gap.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const kenBurns = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(kenBurns, { toValue: 1, duration: KEN_BURNS_DURATION_MS, useNativeDriver: true }),
        Animated.timing(kenBurns, { toValue: 0, duration: KEN_BURNS_DURATION_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only loop, see doc comment above.
  }, []);

  const kenBurnsScale = kenBurns.interpolate({ inputRange: [0, 1], outputRange: [1, KEN_BURNS_MAX_SCALE] });

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    setHeight(e.nativeEvent.layout.height);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  async function finish() {
    await markOnboardingSeen();
    router.replace('/(auth)/sign-in');
  }

  function goToSlide(index: number) {
    setPage(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  }

  return (
    <View style={styles.flex} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        accessibilityLabel={`Onboarding, ${page + 1} of ${onboardingSlides.length}`}
      >
        {onboardingSlides.map((slide, index) => {
          const isLast = index === onboardingSlides.length - 1;

          return (
            <View
              key={index}
              testID={`onboarding-slide-${index}`}
              style={width && height ? { width, height } : styles.pageFallback}
            >
              <View style={styles.imageWrap}>
                <Animated.Image
                  source={slide.image}
                  style={[styles.image, { transform: [{ scale: kenBurnsScale }] }]}
                  resizeMode="cover"
                />
                <View style={[styles.skipRow, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
                  <LinkButton label="Skip" onPress={finish} />
                </View>
              </View>
              <View style={styles.card}>
                <View style={styles.copy}>
                  <AppText variant="display.section" tone="inverse">
                    {slide.headline}
                  </AppText>
                  <AppText variant="ui.body" tone="inverse">
                    {slide.body}
                  </AppText>
                </View>
                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
                  <View style={styles.dots}>
                    {onboardingSlides.map((_, dotIndex) => (
                      <View
                        key={dotIndex}
                        testID={`onboarding-dot-${index}-${dotIndex}`}
                        style={[styles.dot, dotIndex === page && styles.dotActive]}
                      />
                    ))}
                  </View>
                  <PrimaryButton
                    label={isLast ? 'Get Started' : 'Next'}
                    onPress={isLast ? finish : () => goToSlide(index + 1)}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  pageFallback: {
    width: '100%',
    flex: 1,
  },
  imageWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  image: {
    flex: 1,
    width: '100%',
  },
  skipRow: {
    position: 'absolute',
    right: spacing.lg,
  },
  card: {
    backgroundColor: colors.primaryButton.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xxl,
    shadowColor: colors.shadow.card,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 12,
  },
  copy: {
    gap: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border.card,
  },
  dotActive: {
    backgroundColor: colors.accent.gold,
    width: 20,
  },
});
