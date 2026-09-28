import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { usePlatformOS } from '../../../components/navigation/platform';

export interface PlayerHeaderProps {
  onBack: () => void;
}

/**
 * Player screen's nav header — same platform chrome swap as sermon-detail's
 * `DetailHeader` (design spec §8.1.1/§8.5 pattern, reused here rather than
 * re-invented): iOS floats transparent over the video surface, Android is a
 * solid M3 top app bar in normal flow. No overflow/menu icon (share-clip is
 * cut, L5; download lives in its own row below the transport controls, not
 * the header — see `[id].tsx`'s docstring).
 */
export function PlayerHeader({ onBack }: PlayerHeaderProps) {
  const os = usePlatformOS();
  const insets = useSafeAreaInsets();

  if (os === 'android') {
    return (
      <View testID="player-header-android" style={[styles.androidBar, { paddingTop: insets.top }]}>
        <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={onBack} />
      </View>
    );
  }

  return (
    <View testID="player-header-ios" style={[styles.iosBar, { top: insets.top }]} pointerEvents="box-none">
      <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  androidBar: {
    backgroundColor: colors.surface.nav,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  iosBar: {
    position: 'absolute',
    left: spacing.xs,
    zIndex: 10,
  },
});
