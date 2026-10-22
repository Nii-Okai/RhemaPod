import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, LinkButton, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';
import { LEAF_SM } from '../../(tabs)/_home/signature/leaf';
import { InlineAlert } from './inline-alert';

export type CheckEmailKind = 'code' | 'reset';

const RESEND_COOLDOWN_SECONDS = 30;

const TIPS: Record<CheckEmailKind, string[]> = {
  code: [
    'Enter the 6-digit code from the email RhemaPod just sent you.',
    "Can't find it? Check your spam or promotions folder.",
  ],
  reset: [
    'Open the email from RhemaPod and tap the reset link.',
    "Can't find it? Check your spam or promotions folder.",
    'The link expires, so use it soon.',
  ],
};

/**
 * The "we sent you an email" card body — forgot-password's sent state (`kind="reset"`)
 * and sign-up's email confirmation (`kind="code"`, above a `CodeInput`). The screen owns
 * the heading; this owns the sent-to line, the flame-bulleted tips and the resend control.
 *
 * `onResend` is optional: without it there's no resend link. With it, resend waits out a
 * short client-side cooldown so a nervous double-tap doesn't fire a second email (the
 * backend rate-limits too; this is just politeness).
 */
export function CheckEmailBody({
  email,
  kind,
  onResend,
  onUseDifferentEmail,
}: {
  email?: string | null;
  kind: CheckEmailKind;
  onResend?: () => Promise<void>;
  onUseDifferentEmail?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleResend() {
    if (!onResend) return;
    setResending(true);
    setResent(false);
    setResendError(null);
    try {
      await onResend();
      setResent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setResendError('Could not reach the server. Check your connection and try again.');
    } finally {
      setResending(false);
    }
  }

  return (
    <View style={styles.body}>
      <View style={styles.sentTo}>
        <View style={styles.mailChip}>
          <PlatformIcon name="mail-outline" size={20} color={colors.accent.goldText} />
        </View>
        <View style={styles.sentToText}>
          <AppText variant="mono.meta" tone="tertiary">
            SENT TO
          </AppText>
          <AppText variant="ui.bodyLarge" tone="primary" numberOfLines={1}>
            {email || 'your email address'}
          </AppText>
        </View>
      </View>

      <View style={styles.tips}>
        {TIPS[kind].map((tip) => (
          <View key={tip} style={styles.tip}>
            <View style={styles.tipFlame}>
              <Flame width={8} fill={colors.accent.gold} />
            </View>
            <AppText variant="ui.body" tone="secondary" style={styles.tipText}>
              {tip}
            </AppText>
          </View>
        ))}
      </View>

      {resent ? (
        <InlineAlert variant="success" title="Sent again">
          Give it a minute to arrive.
        </InlineAlert>
      ) : null}
      {resendError ? (
        <InlineAlert variant="error" title="Could not resend">
          {resendError}
        </InlineAlert>
      ) : null}

      {onResend || onUseDifferentEmail ? (
        <View style={styles.actions}>
          {onResend ? (
            cooldown > 0 ? (
              <AppText variant="ui.body" tone="tertiary">
                Resend in{' '}
                <AppText variant="mono.tight" tone="tertiary">
                  {`0:${String(cooldown).padStart(2, '0')}`}
                </AppText>
              </AppText>
            ) : (
              <LinkButton
                label={resending ? 'Sending…' : 'Resend email'}
                disabled={resending}
                onPress={() => void handleResend()}
              />
            )
          ) : null}
          {onUseDifferentEmail ? <LinkButton label="Use a different email" onPress={onUseDifferentEmail} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  body: {
    gap: spacing.xl,
  },
  sentTo: {
    ...LEAF_SM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  mailChip: {
    ...LEAF_SM,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip.circle,
  },
  sentToText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tips: {
    gap: spacing.md,
  },
  tip: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tipFlame: {
    paddingTop: 4,
  },
  tipText: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
}));
