import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, LinkButton, PlatformIcon, PrimaryButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { isComplianceContentPending } from '../../../lib/content/commentsCompliance';
import { useChurchContent } from '../../../lib/query/hooks/useChurchSettings';
import { useAcceptCommentsTerms } from '../../../lib/query/hooks/useProfile';
import { Sheet } from '../../../components/Sheet';

// The guidelines open with their own title line ("RhemaPod Comment Guidelines") followed
// by a blank line, then the body — split once so the title can render bold (the sheet's
// own "Comment guidelines" label header was removed as redundant with it). Staff edit the
// text in the admin portal, whose hint says the first line is the title.
export function splitTerms(text: string): { title: string; body: string } {
  const [title, ...bodyParts] = text.split('\n\n');
  return { title, body: bodyParts.join('\n\n') };
}

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
 * text is the server's `comment_guidelines` (`GET /settings/public`), falling back to
 * `COMMENTS_TERMS_TEXT` (Isaac's input I2; see `lib/content/commentsCompliance.ts`) offline,
 * on error or on first launch — never drafted here. The agree control is a checkbox row and "Agree and continue" stays
 * disabled until it is ticked. Reading to the end is deliberately not forced. "Not now"
 * closes without posting; the caller's draft is untouched.
 */
export function TermsSheet({ visible, readOnly = false, onClose, onAccepted }: TermsSheetProps) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useAcceptCommentsTerms();
  const { commentGuidelines } = useChurchContent();
  const { title, body } = splitTerms(commentGuidelines);
  // Release gate: if the text in use is still a placeholder, accepting it would record
  // consent to nothing, so the button stays disabled until real text ships.
  const termsPending = isComplianceContentPending(commentGuidelines);

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
          {title}
        </AppText>
        <AppText variant="ui.body" tone="secondary">
          {body}
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
            <PlatformIcon
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
