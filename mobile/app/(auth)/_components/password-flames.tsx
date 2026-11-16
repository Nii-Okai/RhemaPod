import React from 'react';
import { View } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';

export const MIN_PASSWORD_LENGTH = 12;
const FLAMES = 4;

// The backend's own reject list (`_COMMON_PASSWORDS` in `app/models/schemas.py`), plus
// the words people most often build a password around. Matched as substrings, so
// "Password2026!!" still reads as weak even though the server would accept it.
const SERVER_COMMON = [
  'password', '123456789012', 'qwertyuiop', 'letmein12345',
  'administrator', 'welcome12345', 'changeme1234', 'password1234',
];
const COMMON_WORDS = [
  ...SERVER_COMMON,
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'changeme', 'admin', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'football', 'princess', 'abc123', 'jesus', 'christ',
  'blessed', 'church', 'prophet', 'rhemapod', 'amen', 'hallelujah',
];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: PasswordScore;
  /** True when the server would reject it outright as too common. */
  tooCommon: boolean;
  meetsLength: boolean;
}

/** Mirrors the server's `_validate_password_strength` common-password check exactly. */
export function isServerCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const stripped = lower.replace(/^[0-9!]+|[0-9!]+$/g, '');
  return SERVER_COMMON.includes(lower) || SERVER_COMMON.includes(stripped);
}

/** Length of every run of 3+ steps through a keyboard row/alphabet/digits, either way. */
function sequenceLength(lower: string): number {
  let total = 0;
  let run = 1;
  for (let i = 1; i < lower.length; i++) {
    const pair = lower[i - 1] + lower[i];
    const stepped = SEQUENCES.some(
      (seq) => seq.includes(pair) || seq.includes(pair.split('').reverse().join('')),
    );
    if (stepped) {
      run++;
    } else {
      if (run >= 3) total += run;
      run = 1;
    }
  }
  if (run >= 3) total += run;
  return total;
}

/**
 * A small, dependency-free strength estimate (a full zxcvbn dictionary would add ~800KB
 * to the bundle). Starts from length × the size of the character pool in use, then
 * discounts what crackers try first: repeated characters, keyboard/alphabet runs, and
 * common words. Advisory only — the server remains the authority on what's accepted.
 */
export function passwordStrength(password: string): PasswordStrength {
  const meetsLength = password.length >= MIN_PASSWORD_LENGTH;
  const tooCommon = isServerCommonPassword(password);
  if (!password) return { score: 0, tooCommon, meetsLength };

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;

  const lower = password.toLowerCase();
  let effective = password.length;
  // Runs of the same character ("aaaa") add almost nothing past the first one.
  effective -= (password.match(/(.)\1+/g) ?? []).reduce((n, run) => n + run.length - 1, 0);
  effective -= sequenceLength(lower) * 0.75;
  for (const word of COMMON_WORDS) {
    if (lower.includes(word)) effective -= word.length - 1;
  }
  // Few distinct characters ("abababab…") cap how much the length is worth.
  effective = Math.min(effective, new Set(password).size * 1.5);
  const bits = Math.max(0, effective) * Math.log2(Math.max(pool, 1));

  let score: PasswordScore = bits < 30 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (tooCommon) score = 0;
  // Under the minimum the server will refuse it, so it can't read as better than weak.
  if (!meetsLength) score = Math.min(score, 1) as PasswordScore;
  return { score, tooCommon, meetsLength };
}

const LABELS: Record<PasswordScore, string> = {
  0: 'Too weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Very strong',
};

/**
 * Password-strength meter in Signature's own marker: a row of flames that light with the
 * estimated strength (`passwordStrength` above), not just the length. Below the
 * backend's 12-character minimum the hint keeps counting down the characters still
 * needed; past it, the hint names the strength and how to raise it.
 */
export function PasswordFlames({ password }: { password: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { score, tooCommon, meetsLength } = passwordStrength(password);
  const lit = password ? Math.max(1, score) : 0;
  const strong = meetsLength && score >= 3;
  const remaining = Math.max(0, MIN_PASSWORD_LENGTH - password.length);

  const hint =
    password.length === 0
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : tooCommon
        ? 'Too common. Choose something less predictable.'
        : !meetsLength
          ? `${remaining} more character${remaining === 1 ? '' : 's'}.`
          : score <= 2
            ? `${LABELS[score]}. Add words, numbers or symbols.`
            : `${LABELS[score]}.`;

  return (
    <View
      style={styles.row}
      accessibilityLiveRegion="polite"
      accessibilityLabel={password ? `Password strength: ${LABELS[score]}. ${hint}` : hint}
    >
      <View style={styles.flames} accessible={false}>
        {Array.from({ length: FLAMES }, (_, i) =>
          i < lit ? (
            <Flame key={i} width={9} fill={strong ? colors.accent.gold : colors.accent.goldText} />
          ) : (
            <Flame key={i} width={9} fill="transparent" stroke={colors.border.card} />
          ),
        )}
      </View>
      <AppText variant="ui.badge" tone={strong ? 'gold' : 'tertiary'}>
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
