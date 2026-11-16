import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { usePlatformOS } from '../../../components/navigation/platform';

export interface DetailHeaderProps {
  onBack: () => void;
}

/**
 * Nav header platform swap (design spec §8.1.1/§8.5). iOS: transparent, floats over the
 * hero art (absolutely positioned so it takes no layout space and the hero bleeds to the
 * top edge beneath it), icon-only back control, no title text. Android: a real M3 top app
 * bar — solid `surface.nav` fill, back-arrow icon at the start, in normal flow so it pushes
 * the hero below it. Neither platform reserves an overflow/menu icon (§8.5: nothing
 * populates it on this screen — share/clip-share is cut, L5).
 */
export function DetailHeader({ onBack }: DetailHeaderProps) {
  const styles = useStyles();
  const os = usePlatformOS();
  const insets = useSafeAreaInsets();

  if (os === 'android') {
    return (
      <View testID="detail-header-android" style={[styles.androidBar, { paddingTop: insets.top }]}>
        <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={onBack} />
      </View>
    );
  }

  return (
    <View
      testID="detail-header-ios"
      style={[styles.iosBar, { top: insets.top }]}
      pointerEvents="box-none"
    >
      <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));
