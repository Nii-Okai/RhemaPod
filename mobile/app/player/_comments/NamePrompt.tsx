import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText, LinkButton, PrimaryButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';
import { previewDisplayName } from '../../../lib/format/displayName';
import { useUpdateFullName, type UserPublic } from '../../../lib/query/hooks/useProfile';
import { Sheet } from '../../../components/Sheet';
import { nameErrorMessage } from './commentErrors';

const MAX_NAME_LENGTH = 100;

export interface NamePromptProps {
  visible: boolean;
  initialName: string;
  /** Sheet heading: "Add your name" before the first post, "Your name" when editing in Me. */
  title: string;
  saveLabel: string;
  onClose: () => void;
  /** Fired after the server accepted the name, with the updated profile (the cache already holds it). */
  onSaved: (user: UserPublic) => void;
}

/**
 * The full-name sheet (design spec §2.7, with the K5 impersonation call): shown before a
 * first post when `full_name` is blank, and reused by Me > Name and the "Change" link on
 * the one-time notice. Real name only — there is no nickname hint. The "First L." preview is
 * a local convenience using the server's rule; the server's own validation (links, contact
 * details, blocklisted words, reserved titles — all one generic 422) is the authority, and
 * its message is shown as-is.
 */
export function NamePrompt({ visible, initialName, title, saveLabel, onClose, onSaved }: NamePromptProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateFullName();

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setError(null);
    }
  }, [visible, initialName]);

  const trimmed = name.trim();
  const preview = previewDisplayName(trimmed);

  const save = () => {
    setError(null);
    update.mutate(trimmed, {
      onSuccess: (user) => onSaved(user),
      onError: (err) => setError(nameErrorMessage(err)),
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
        {title}
      </AppText>
      <AppText variant="ui.body" tone="secondary">
        Use your real name. It appears with your comments as your first name and last initial. Never your email.
      </AppText>
      <View style={styles.field}>
        <AppText variant="ui.label" tone="secondary">
          Full name
        </AppText>
        <TextInput
          accessibilityLabel="Full name"
          value={name}
          onChangeText={setName}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          placeholderTextColor={colors.text.tertiary}
          style={styles.input}
        />
      </View>
      {preview ? (
        <AppText variant="ui.body" accessibilityLiveRegion="polite">
          {`You'll appear as ${preview}`}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <PrimaryButton label={saveLabel} disabled={trimmed.length === 0} loading={update.isPending} onPress={save} />
      <View style={styles.cancel}>
        <LinkButton label="Cancel" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: {
    textTransform: 'uppercase',
  },
  field: {
    gap: spacing.xs,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 16,
  },
  error: {
    color: colors.status.rose.text,
  },
  cancel: {
    alignItems: 'center',
  },
});
