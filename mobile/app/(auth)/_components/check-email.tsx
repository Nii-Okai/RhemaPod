import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, LinkButton, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
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
      <View style={styles.sentTo} accessible accessibilityLabel={`Sent to ${email || 'your email address'}`}>
        <PlatformIcon name="mail-outline" size={18} color={colors.text.tertiary} />
        <AppText variant="ui.bodyBold" tone="primary" numberOfLines={1} style={styles.sentToText}>
          {email || 'your email address'}
        </AppText>
      </View>

      <View style={styles.tips}>
        {TIPS[kind].map((tip) => (
          <View key={tip} style={styles.tip}>
            <View style={styles.tipDot} />
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
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  sentToText: {
    flexShrink: 1,
  },
  tips: {
    gap: spacing.md,
  },
  tip: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.sunButton.bg,
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

/**
 * The "Check your email" illustration (canvas A5): a letter rising out of a navy
 * envelope on a soft blue tile, with a green tick at its corner.
 */
export function MailArt() {
  const styles = useArtStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={styles.tile} />
      <View style={styles.letter}>
        <View style={[styles.line, styles.lineSun]} />
        <View style={[styles.line, styles.lineLong]} />
        <View style={[styles.line, styles.lineShort]} />
      </View>
      <View style={styles.envelope} />
      <View style={styles.tick}>
        <PlatformIcon name="checkmark" size={22} color={colors.status.sage.bg} />
      </View>
    </View>
  );
}

const useArtStyles = createThemedStyles((colors) => ({
  wrap: { width: 180, height: 150 },
  tile: { position: 'absolute', left: 0, right: 0, top: 20, bottom: 0, borderRadius: 28, backgroundColor: colors.iris.soft },
  letter: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: 0,
    height: 96,
    borderRadius: 18,
    padding: 18,
    gap: 8,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  line: { height: 6, borderRadius: 3, backgroundColor: colors.border.default },
  lineSun: { height: 8, width: '70%', borderRadius: 4, backgroundColor: colors.sunButton.bg },
  lineLong: { width: '90%' },
  lineShort: { width: '60%' },
  envelope: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    backgroundColor: colors.iris.fill,
  },
  tick: {
    position: 'absolute',
    right: -6,
    top: 6,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.sage.text,
  },
}));
