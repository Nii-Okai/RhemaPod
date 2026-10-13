import React from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface HomeTopBarProps {
  onSearchPress: () => void;
  onNotificationsPress: () => void;
  /** New-release count since the user last opened Notifications (Isaac's ask, session
   * 2026-10-11: "Show counter") — a small badge on the bell, omitted entirely at 0. */
  unseenNotificationsCount?: number;
  /** Drives the bar's background fade (Isaac's ask, session 2026-09-30: a Prime
      Video/Netflix-style top bar that's transparent over the hero and solidifies as
      you scroll past it). Omitted entirely, the bar just renders solid, same as
      before — this prop is optional so the bar stays usable on its own. */
  scrollY?: Animated.Value;
  /** How far (px) into the scroll the fade completes. */
  fadeDistance?: number;
  /** Reports the bar's own rendered height, so the screen can keep whatever sits
      right underneath it (the hero's own top-left chip, say) clear of the bar's
      icons once it's overlaid absolutely rather than pushing content down. */
  onHeight?: (height: number) => void;
}

const DEFAULT_FADE_DISTANCE = 180;

/**
 * Home's top app bar — wordmark left, quick-access icons right, matching the header
 * pattern of reference video/streaming apps. Pads for the status bar / notch itself
 * (theme/spacing.ts: safe-area paddings are handled at the call site, not a fixed
 * token) so its own content never draws under the system chrome, independent of
 * whether the screen positions the bar in normal flow or absolutely overlaid.
 *
 * The bell no longer opens Announcements (Isaac's ask, session 2026-10-11: "should open
 * notifications page showing new releases") — it pushes `/notifications` instead, with a
 * small unread-count badge (`unseenNotificationsCount`, `useNotificationsBadge`'s own
 * doc comment). Announcements itself is still reachable, just from the You tab's own row
 * now, not from here.
 *
 * Two background layers, both always present so the bar reads correctly whether or
 * not a caller passes `scrollY`:
 *  - A constant, low-opacity dark scrim — keeps the wordmark/icons legible over
 *    whatever art might sit behind the bar at rest (this app's real thumbnails are
 *    flat, busy title-card graphics with no reserved safe area — `HeroCard`'s own
 *    eyebrow chip and play button use the same translucent-scrim reasoning).
 *  - A scroll-driven solid fill on top of that, fading in from fully transparent to
 *    fully opaque as `scrollY` advances toward `fadeDistance` — this is the part
 *    that actually changes as you scroll.
 */
export function HomeTopBar({
  onSearchPress,
  onNotificationsPress,
  unseenNotificationsCount = 0,
  scrollY,
  fadeDistance = DEFAULT_FADE_DISTANCE,
  onHeight,
}: HomeTopBarProps) {
  const insets = useSafeAreaInsets();

  const solidOpacity = scrollY
    ? scrollY.interpolate({
        inputRange: [0, fadeDistance],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : 1;

  const handleLayout = (e: LayoutChangeEvent) => onHeight?.(e.nativeEvent.layout.height);

  return (
    <View testID="home-top-bar" style={styles.root} onLayout={handleLayout}>
      <View style={styles.scrim} />
      <Animated.View style={[styles.solidFill, { opacity: solidOpacity }]} />
      <View style={[styles.bar, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <AppText variant="display.row">
          Rhema
          <AppText variant="display.row" tone="gold">
            Pod
          </AppText>
        </AppText>
        <View style={styles.actions}>
          <View>
            <IconButton icon="notifications-outline" accessibilityLabel="Notifications" onPress={onNotificationsPress} />
            {unseenNotificationsCount > 0 ? (
              <View style={styles.badge} pointerEvents="none">
                <AppText variant="ui.label" tone="inverse" style={styles.badgeText}>
                  {unseenNotificationsCount > 9 ? '9+' : String(unseenNotificationsCount)}
                </AppText>
              </View>
            ) : null}
          </View>
          <IconButton icon="search-outline" accessibilityLabel="Search" onPress={onSearchPress} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay.chipFill,
  },
  solidFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
  },
});
