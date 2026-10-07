import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { usePlatformOS } from '../../../components/navigation/platform';

export interface PlayerHeaderProps {
  onBack: () => void;
  /** The sermon title. Absent on the loading/error states, where it isn't known yet. */
  title?: string;
}

/**
 * Player screen header (design spec comments-and-player §1.1): a solid `surface.app` bar
 * with the back control and the sermon title, always visible — it is not part of the
 * auto-hiding video overlay, so Back is never lost. The title wraps to two lines rather
 * than truncating to one, since cutting a title short at large text sizes hides meaning.
 * Android keeps its `arrow-back` glyph; iOS uses the chevron. No overflow/menu icon
 * (share-clip is cut, L5; download lives in its own row under the bottom bar).
 */
export function PlayerHeader({ onBack, title }: PlayerHeaderProps) {
  const os = usePlatformOS();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={os === 'android' ? 'player-header-android' : 'player-header-ios'}
      style={[styles.bar, { paddingTop: insets.top }]}
    >
      <IconButton icon={os === 'android' ? 'arrow-back' : 'chevron-back'} accessibilityLabel="Back" onPress={onBack} />
      {title ? (
        <AppText variant="display.compact" numberOfLines={2} accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface.app,
  },
  title: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
});
