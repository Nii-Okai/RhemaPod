import React from 'react';
import { View } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';

export const MIN_PASSWORD_LENGTH = 12;
const FLAMES = 4;

/**
 * Password-length meter in Signature's own marker: a row of flames that light one by one
 * as the password grows toward the backend's 12-character minimum (`UserRegister` /
 * `ResetPasswordRequest` in `app/models/schemas.py`) — the same "row of flames tracks
 * progress" idea as Home's series walk. Length only; the server stays the authority on
 * strength and its 422 copy is shown verbatim by the screen.
 */
export function PasswordFlames({ length }: { length: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const lit = Math.min(FLAMES, Math.floor((length / MIN_PASSWORD_LENGTH) * FLAMES));
  const remaining = Math.max(0, MIN_PASSWORD_LENGTH - length);
  const met = remaining === 0;

  const hint =
    length === 0
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : met
        ? 'Long enough.'
        : `${remaining} more character${remaining === 1 ? '' : 's'}.`;

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <View style={styles.flames} accessible={false}>
        {Array.from({ length: FLAMES }, (_, i) =>
          i < lit ? (
            <Flame key={i} width={9} fill={met ? colors.accent.gold : colors.accent.goldText} />
          ) : (
            <Flame key={i} width={9} fill="transparent" stroke={colors.border.card} />
          ),
        )}
      </View>
      <AppText variant="ui.badge" tone={met ? 'gold' : 'tertiary'}>
        {hint}
      </AppText>
    </View>
  );
}

const useStyles = createThemedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flames: {
    flexDirection: 'row',
    gap: 3,
  },
}));
