import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon } from '../../../components';
import { Artwork } from '../../../components/Artwork';
import { useCurrentUser } from '../../../lib/query/hooks/useProfile';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface HomeHeaderProps {
  onSearchPress: () => void;
  onNotificationsPress: () => void;
  /** New releases since Notifications was last opened; a dot on the bell, none at 0. */
  unseenNotificationsCount?: number;
  /** For tests: the clock the greeting reads. */
  now?: Date;
  /** Laid over the bar's own style; Home clears its ground to sit in a frosted header. */
  style?: StyleProp<ViewStyle>;
}

/** "Good morning" before noon, "Good afternoon" before five, "Good evening" after. */
export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Home's header (Daybreak redesign, canvas B1/B2): the real RhemaPod wordmark over a
 * time-of-day greeting with the listener's first name, and round Search and Notifications
 * buttons on the right. It sits in normal flow above the scroll, on the page's own ground.
 */
export function HomeHeader({ onSearchPress, onNotificationsPress, unseenNotificationsCount = 0, now, style }: HomeHeaderProps) {
  const styles = useStyles();
  const { scheme, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: user } = useCurrentUser();
  // No name saved yet (an Apple sign-in that hid it, or a new email account): the greeting
  // stands alone, "Good evening". The email is never used in its place.
  const firstName = user?.first_name?.trim() || user?.full_name?.trim().split(/\s+/)[0];
  const greeting = greetingFor(now ?? new Date());
  const wordmark =
    scheme === 'light'
      ? require('../../../assets/brand/wordmark-on-light.png')
      : require('../../../assets/brand/wordmark-on-dark.png');
  const unseen = unseenNotificationsCount > 0;

  return (
    <View testID="home-header" style={[styles.bar, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.md }, style]}>
      <View style={styles.titles}>
        <Artwork
          fallback={wordmark}
          style={styles.wordmark}
          contentFit="contain"
          transition={0}
          accessible
          accessibilityLabel="RhemaPod"
        />
        {/* Two lines at most, smallest display size: a long first name wraps rather than
            being cut off (Nii's phone test, 2026-11-11). */}
        <AppText variant="display.row" accessibilityRole="header" numberOfLines={2}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </AppText>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={onSearchPress}
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <PlatformIcon name="search-outline" size={20} color={colors.text.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unseen ? `Notifications, ${unseenNotificationsCount} new` : 'Notifications'}
          onPress={onNotificationsPress}
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <PlatformIcon name="notifications-outline" size={20} color={colors.text.primary} />
          {unseen ? <View style={styles.dot} pointerEvents="none" /> : null}
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface.app,
  },
  titles: {
    flex: 1,
    gap: spacing.xs + 2,
  },
  wordmark: {
    width: 100,
    height: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent.gold,
    borderWidth: 2,
    borderColor: colors.surface.raised,
  },
}));
