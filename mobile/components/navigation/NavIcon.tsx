import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../theme/colors';
import { PlatformIcon } from '../PlatformIcon';
import { Avatar } from '../Avatar';
import { useCurrentUser } from '../../lib/query/hooks/useProfile';
import type { NavRoute } from './routes';

export interface NavIconProps {
  route: NavRoute;
  active: boolean;
  size: number;
  color: string;
}

/**
 * The "You" tab (Isaac's ask, session 2026-10-11: "Change 'Me' tab to 'You' and include
 * avatar") renders the caller's own `Avatar` here instead of a generic person glyph,
 * same as every reference app with a profile-picture tab (YouTube's own "You"). Every
 * other route still gets the plain device-appropriate `PlatformIcon`. Shared by every
 * nav chrome that shows icons (`IconNavItem` — Android bottom bar + tablet rail — and
 * `PhoneTabBarIOS`) so the avatar special-case exists in exactly one place.
 *
 * A gold ring stands in for `PlatformIcon`'s own color-only active state — an avatar is
 * already a filled circle, so there's no "outline vs. filled" glyph swap to lean on.
 */
export function NavIcon({ route, active, size, color }: NavIconProps) {
  const { data: user } = useCurrentUser();

  if (route.key === 'me') {
    return (
      <View style={[styles.avatarRing, active && styles.avatarRingActive, { width: size + 6, height: size + 6 }]}>
        <Avatar name={user?.full_name ?? 'You'} imageUri={user?.avatar_url} size={size} />
      </View>
    );
  }

  return <PlatformIcon name={active ? route.iconActive : route.icon} size={size} color={color} />;
}

const styles = StyleSheet.create({
  avatarRing: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  avatarRingActive: {
    borderWidth: 2,
    borderColor: colors.accent.gold,
  },
});
