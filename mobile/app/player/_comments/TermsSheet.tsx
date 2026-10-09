import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, LinkButton, PrimaryButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { COMMENTS_TERMS_TEXT, isComplianceContentPending } from '../../../lib/content/commentsCompliance';
import { useAcceptCommentsTerms } from '../../../lib/query/hooks/useProfile';
import { Sheet } from '../../../components/Sheet';

// `COMMENTS_TERMS_TEXT` opens with its own title line ("RhemaPod Comment Guidelines")
// followed by a blank line, then the body — split once so the title can render bold
// (the sheet's own "Comment guidelines" label header was removed as redundant with it).
const [TERMS_TITLE, ...TERMS_BODY_LINES] = COMMENTS_TERMS_TEXT.split('\n\n');
const TERMS_BODY = TERMS_BODY_LINES.join('\n\n');

export interface TermsSheetProps {
  visible: boolean;
  /** Read-only mode (Me > Comment guidelines): no checkbox, no accept call. */
  readOnly?: boolean;
  onClose: () => void;
  /** Fired after the server recorded acceptance. */
  onAccepted?: () => void;
}

/**
 * The comment guidelines sheet (design spec §2.7) — a hard gate before the first post. The
 * body is `COMMENTS_TERMS_TEXT` (Isaac's input I2; see `lib/content/commentsCompliance.ts`),
 * never drafted here. The agree control is a checkbox row and "Agree and continue" stays
 * disabled until it is ticked. Reading to the end is deliberately not forced. "Not now"
 * closes without posting; the caller's draft is untouched.
 */
export function TermsSheet({ visible, readOnly = false, onClose, onAccepted }: TermsSheetProps) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useAcceptCommentsTerms();
  // Release gate: COMMENTS_TERMS_TEXT is still Isaac's placeholder (I2) on this build.
  // Accepting placeholder legal text would record consent to nothing, so the button
  // stays disabled until the real text ships.
  const termsPending = isComplianceContentPending(COMMENTS_TERMS_TEXT);

  useEffect(() => {
    if (visible) {
      setAgreed(false);
      setError(null);
    }
  }, [visible]);

  const submit = () => {
    setError(null);
    accept.mutate(undefined, {
      onSuccess: () => onAccepted?.(),
      onError: () => setError("Couldn't save your agreement. Try again."),
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.terms}>
        <AppText variant="ui.bodyBold" accessibilityRole="header">
          {TERMS_TITLE}
        </AppText>
        <AppText variant="ui.body" tone="secondary">
          {TERMS_BODY}
        </AppText>
      </View>
      {readOnly ? (
        <View style={styles.cancel}>
          <LinkButton label="Close" onPress={onClose} />
        </View>
      ) : (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to the comment guidelines"
            onPress={() => setAgreed((value) => !value)}
            style={styles.checkRow}
          >
            <Ionicons
              name={agreed ? 'checkbox' : 'square-outline'}
              size={24}
              color={agreed ? colors.accent.goldText : colors.text.tertiary}
            />
            <AppText variant="ui.body" style={styles.checkLabel}>
              I agree to the comment guidelines
            </AppText>
          </Pressable>
          {error ? (
            <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          ) : null}
          <PrimaryButton
            label="Agree and continue"
            disabled={!agreed || termsPending}
            loading={accept.isPending}
            onPress={submit}
          />
          <View style={styles.cancel}>
            <LinkButton label="Not now" onPress={onClose} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  terms: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
  },
  checkLabel: {
    flex: 1,
  },
  error: {
    color: colors.status.rose.text,
  },
  cancel: {
    alignItems: 'center',
  },
});
