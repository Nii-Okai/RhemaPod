import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import { useTheme } from '../theme/ThemeContext';

/**
 * Frosted chrome (the tab dock, the tab screens' headers, the mini player card): a native
 * blur of whatever scrolls underneath, with a tint of the surface's own colour on top, so
 * the page shows through softly the way it does under Apple Music's bars.
 *
 * iOS only. Android's blur in this Expo version is experimental and slow, so there the same
 * surfaces get a near-opaque colour instead (`*Solid`), still faintly see-through. iOS with
 * Reduce Transparency on gets the same solid colour, as the system's own bars do.
 */
export type FrostVariant = 'dock' | 'header' | 'card';

const BLUR_INTENSITY = 60;

// Reduce Transparency, read once for the whole app and kept current: every frosted surface
// shares it instead of each asking the system and listening on its own.
let reduceTransparency = false;
const reduceListeners = new Set<() => void>();
let watching = false;
function watchReduceTransparency() {
  if (watching || Platform.OS !== 'ios') return;
  watching = true;
  const set = (value: boolean) => {
    if (value === reduceTransparency) return;
    reduceTransparency = value;
    reduceListeners.forEach((listener) => listener());
  };
  void AccessibilityInfo.isReduceTransparencyEnabled()
    .then(set)
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceTransparencyChanged', set);
}
function subscribeReduceTransparency(listener: () => void) {
  watchReduceTransparency();
  reduceListeners.add(listener);
  return () => {
    reduceListeners.delete(listener);
  };
}

/** Whether this device frosts at all: iOS with Reduce Transparency off. */
export function useFrostEnabled(): boolean {
  const reduce = useSyncExternalStore(subscribeReduceTransparency, () => reduceTransparency);
  return Platform.OS === 'ios' && !reduce;
}

/**
 * The background colour a frosted surface's own view should carry: clear when the blur
 * layer paints it, the solid fallback otherwise. Putting the fallback on the surface itself
 * (not on a child layer) keeps Android's elevation shadow, which follows the view's own
 * background.
 */
export function useFrostBackground(variant: FrostVariant): string {
  const { colors } = useTheme();
  return useFrostEnabled() ? 'transparent' : colors.frost[`${variant}Solid`];
}

/**
 * The blur layer. Drop it in as the first child of a surface whose background is
 * `useFrostBackground(variant)`; it fills the surface and clips to `borderRadius`. Renders
 * nothing where the device doesn't frost.
 */
export function FrostedBackdrop({ variant, borderRadius = 0 }: { variant: FrostVariant; borderRadius?: number }) {
  const { colors } = useTheme();
  const enabled = useFrostEnabled();
  if (!enabled) return null;
  return (
    <View testID={`frost-${variant}`} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { borderRadius }]}>
      <BlurView
        tint={colors.frost[`${variant}Tint`] as BlurTint}
        intensity={BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.frost[variant] }]} />
    </View>
  );
}

/**
 * A screen header laid over the top of its scroll view, frosted, so content scrolls up
 * under it. It reports its height so the scroll can start below it
 * (`useFrostedScroll`), and draws a hairline along its foot once the page has scrolled.
 */
export function FrostedHeader({
  children,
  scrolled = false,
  onHeight,
  style,
  testID = 'frosted-header',
}: {
  children?: React.ReactNode;
  scrolled?: boolean;
  onHeight?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const backgroundColor = useFrostBackground('header');
  return (
    <View
      testID={testID}
      style={[
        styles.header,
        { backgroundColor, borderBottomColor: scrolled ? colors.frost.hairline : 'transparent' },
        style,
      ]}
      onLayout={onHeight ? (event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height) : undefined}
    >
      <FrostedBackdrop variant="header" />
      {children}
    </View>
  );
}

/** How tall the tab shell's bottom chrome (dock, plus the mini player's band while it is
 * docked) stands over the screen, so a tab's scroll can end above it. 0 off the tabs and on
 * tablets, where the rail sits beside the content instead. */
const BottomChromeContext = createContext(0);
export const BottomChromeInsetProvider = BottomChromeContext.Provider;
export function useBottomChromeInset(): number {
  return useContext(BottomChromeContext);
}

const SCROLLED_AT = 2;

/**
 * Wires a tab's scroll view to the frosted chrome around it: it starts below a header of
 * `headerHeight`, ends above the dock, keeps the scroll bar and pull-to-refresh spinner in
 * the visible band, and says whether the page has scrolled (for the header's hairline).
 *
 * iOS uses a content inset at the top, so the refresh spinner shows below the header and
 * the page can still slide up under it; Android pads the content and moves its spinner
 * down instead. The bottom is padded on both.
 */
export function useFrostedScroll(headerHeight: number) {
  const bottom = useBottomChromeInset();
  const ref = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const appliedTop = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  const ios = Platform.OS === 'ios';

  // A content inset doesn't move the page by itself: when the header's height first
  // arrives (or changes, with a text-size change) and the page is resting at the top,
  // settle it at the new top.
  useEffect(() => {
    if (!ios) return;
    const atTop = offset.current <= -appliedTop.current + SCROLLED_AT;
    appliedTop.current = headerHeight;
    if (atTop) ref.current?.scrollTo({ y: -headerHeight, animated: false });
  }, [headerHeight, ios]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    offset.current = y;
    const next = (ios ? y + headerHeight : y) > SCROLLED_AT;
    if (next !== scrolled) setScrolled(next);
  };

  return {
    ref,
    scrolled,
    /** Spread onto the ScrollView. */
    scrollProps: {
      onScroll,
      scrollEventThrottle: 16,
      contentInset: ios ? { top: headerHeight } : undefined,
      contentOffset: ios ? { x: 0, y: -headerHeight } : undefined,
      scrollIndicatorInsets: { top: headerHeight, bottom },
    },
    /** Merge into the content container style, after its own padding. */
    contentPadding: (paddingTop: number, paddingBottom: number) => ({
      paddingTop: ios ? paddingTop : paddingTop + headerHeight,
      paddingBottom: paddingBottom + bottom,
    }),
    /** For the RefreshControl: where Android draws its spinner. */
    progressViewOffset: ios ? undefined : headerHeight,
  };
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

/**
 * A frosted strip behind the status bar, for tab screens whose title scrolls away with the
 * page (Library, You, Series): the page blurs out under the clock instead of running into
 * it. It matches the page at rest, so it only shows once something scrolls beneath it.
 */
export function FrostedStatusBar({ height }: { height: number }) {
  if (height <= 0) return null;
  return <FrostedHeader testID="frosted-status-bar" style={{ height, borderBottomWidth: 0 }} />;
}
