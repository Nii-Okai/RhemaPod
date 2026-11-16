import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

export interface SignaturePlayerHeaderProps {
  onBack: () => void;
  /** Sits centred in the bar: the Watch / Listen switch, when the player shows one. */
  center?: React.ReactNode;
  /** The right-hand slot: the AirPlay button on iOS. Kept 42 wide so `center` stays centred. */
  right?: React.ReactNode;
}

/**
 * Signature player header: a chevron that closes the player, with the Watch / Listen switch
 * centred beside it. There is no "Now playing" or series label any more (Nii, 2026-11-15:
 * the comments need the room), and the sermon's own title sits below the stage
 * (`NowPlayingDetails`). Sharing one row with the switch saves the old header's whole
 * height. The right slot holds the AirPlay button on iOS, and elsewhere is an empty spacer of
 * the same width, so the switch stays centred either way.
 */
export function SignaturePlayerHeader({ onBack, center, right }: SignaturePlayerHeaderProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <View testID="signature-player-header" style={[styles.bar, { paddingTop: insets.top }]}>
      <IconButton icon="chevron-down" size={26} accessibilityLabel="Close player" onPress={onBack} />
      <View style={styles.center}>{center}</View>
      <View style={styles.spacer}>{right}</View>
    </View>
  );
}

const useStyles = createThemedStyles(() => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    // Clear: the player's art-tinted backdrop (`PlayerBackdrop`) shows through.
    backgroundColor: 'transparent',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  spacer: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
