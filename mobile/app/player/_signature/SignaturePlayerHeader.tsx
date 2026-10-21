import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { SermonDetail } from '../../../lib/query/hooks/useSermons';

export interface SignaturePlayerHeaderProps {
  onBack: () => void;
  /** Absent on the loading/error states, where the sermon isn't known yet. */
  detail?: SermonDetail;
}

/**
 * Signature player header: a chevron that closes the player, and a centred "where am I"
 * label — the series and part when the sermon belongs to one, otherwise "Now playing".
 * The sermon's own title sits below the video (`NowPlayingDetails`), so it isn't repeated
 * here. The right slot is an empty spacer that keeps the label centred; the app has no
 * player overflow menu to put there.
 */
export function SignaturePlayerHeader({ onBack, detail }: SignaturePlayerHeaderProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const label = detail ? (detail.series_title ?? 'Now playing') : null;
  const part = detail?.series_title && detail.episode_number ? `Part ${detail.episode_number}` : null;

  return (
    <View testID="signature-player-header" style={[styles.bar, { paddingTop: insets.top }]}>
      <IconButton icon="chevron-down" size={26} accessibilityLabel="Close player" onPress={onBack} />
      <View style={styles.label}>
        {label ? (
          <AppText variant="ui.label" numberOfLines={1} accessibilityRole="header">
            {label}
          </AppText>
        ) : null}
        {part ? (
          <AppText variant="ui.badge" tone="secondary">
            {part}
          </AppText>
        ) : null}
      </View>
      <View style={styles.spacer} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface.app,
  },
  label: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  spacer: {
    width: 42,
  },
}));
