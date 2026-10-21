import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, PlatformIcon, PrimaryButton } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';
import type { CommentReportReason } from '../../../lib/query/hooks/useComments';
import { Sheet } from '../../../components/Sheet';

const DETAIL_MAX = 500;

const REASONS: { reason: CommentReportReason; label: string; helper: string }[] = [
  { reason: 'spam', label: 'Spam', helper: 'Ads, repeated or unrelated content' },
  { reason: 'harassment', label: 'Harassment or bullying', helper: 'Targets or insults someone' },
  { reason: 'hate', label: 'Hate or abuse', helper: 'Attacks a group of people' },
  { reason: 'sexual', label: 'Sexual content', helper: 'Inappropriate for this app' },
  { reason: 'self_harm', label: 'Self-harm or safety concern', helper: 'Someone may be in danger' },
  { reason: 'other', label: 'Something else', helper: 'Tell us more (optional)' },
];

export interface ReportSheetProps {
  visible: boolean;
  authorName: string;
  onClose: () => void;
  /** Resolves on success, rejects (with the failure shown inline) otherwise. */
  onSubmit: (reason: CommentReportReason, detail?: string) => Promise<void>;
  /** Opens the block confirm. Offered before a report is filed and again after. */
  onBlock: () => void;
  /** Maps a rejection from `onSubmit` to the inline message. */
  errorMessage: (error: unknown) => string;
}

/**
 * Report flow (design spec §2.4): pick a reason, optionally add detail for "Something else",
 * submit. Step 2 confirms and offers Block. Blocking is offered from the first step too, so a
 * viewer — possibly a minor — never has to commit to a report just to stop seeing someone.
 * `self_harm` is an ordinary reason with no special UI.
 */
export function ReportSheet({ visible, authorName, onClose, onSubmit, onBlock, errorMessage }: ReportSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [reason, setReason] = useState<CommentReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [step, setStep] = useState<'choose' | 'done'>('choose');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetail('');
      setStep('choose');
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const submit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason, reason === 'other' && detail.trim() ? detail.trim() : undefined);
      setStep('done');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const blockRow = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Block ${authorName}`}
      onPress={onBlock}
      style={({ pressed }) => [styles.blockRow, pressed && styles.pressed]}
    >
      <PlatformIcon name="ban-outline" size={18} color={colors.status.rose.text} />
      <AppText variant="ui.button" style={styles.blockText}>
        {`Block ${authorName}`}
      </AppText>
    </Pressable>
  );

  if (step === 'done') {
    return (
      <Sheet visible={visible} onClose={onClose}>
        <View accessibilityLiveRegion="polite" style={styles.done}>
          <PlatformIcon name="checkmark-circle" size={32} color={colors.status.sage.text} />
          <AppText variant="ui.bodyLarge">Thanks. We'll review this comment.</AppText>
        </View>
        {blockRow}
        <PrimaryButton label="Done" onPress={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
        Why are you reporting this?
      </AppText>
      {REASONS.map((item) => {
        const selected = item.reason === reason;
        return (
          <Pressable
            key={item.reason}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            onPress={() => setReason(item.reason)}
            style={({ pressed }) => [styles.reasonRow, pressed && styles.pressed]}
          >
            <View style={styles.reasonText}>
              <AppText variant="ui.bodyLarge">{item.label}</AppText>
              <AppText variant="ui.badge" tone="tertiary">
                {item.helper}
              </AppText>
            </View>
            <PlatformIcon
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={selected ? colors.accent.goldText : colors.text.tertiary}
            />
          </Pressable>
        );
      })}
      {reason === 'other' ? (
        <View style={styles.detailWrap}>
          <TextInput
            accessibilityLabel="Optional details"
            value={detail}
            onChangeText={setDetail}
            maxLength={DETAIL_MAX}
            multiline
            placeholder="Optional details"
            placeholderTextColor={colors.text.tertiary}
            style={styles.detail}
          />
          <AppText variant="mono.meta" tone="tertiary" style={styles.counter}>
            {`${detail.length}/${DETAIL_MAX}`}
          </AppText>
        </View>
      ) : null}
      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <PrimaryButton label="Submit report" disabled={!reason} loading={submitting} onPress={submit} />
      {blockRow}
    </Sheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  heading: {
    textTransform: 'uppercase',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  reasonText: {
    flex: 1,
  },
  detailWrap: {
    gap: spacing.xs,
  },
  detail: {
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.lg,
    padding: spacing.md,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 14,
  },
  counter: {
    alignSelf: 'flex-end',
  },
  error: {
    color: colors.status.rose.text,
  },
  done: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  blockText: {
    color: colors.status.rose.text,
  },
  pressed: {
    opacity: 0.7,
  },
}));
