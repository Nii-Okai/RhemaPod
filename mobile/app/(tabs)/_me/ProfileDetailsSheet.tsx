import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, LinkButton, PrimaryButton, Sheet } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';
import { useUpdateProfileDetails, type Gender, type UserPublic } from '../../../lib/query/hooks/useProfile';
import { nameErrorMessage } from '../../player/_comments/commentErrors';

const MAX_NAME_LENGTH = 50;
const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export interface ProfileDetailsSheetProps {
  visible: boolean;
  initialFirstName: string;
  initialLastName: string;
  initialGender: Gender | null;
  onClose: () => void;
  onSaved: (user: UserPublic) => void;
}

/**
 * Me page's own profile editor (Isaac's ask, session 2026-10-09: "Allow to update
 * firstname, lastname and gender") — a sibling of the comments flow's `NamePrompt`, not
 * a replacement: that one still owns the single-field name prompt shown before a first
 * comment post. Saved together in one request (`useUpdateProfileDetails`) since they
 * share one sheet and one Save button; the server itself treats name and gender as
 * independent writes (gender alone is valid, name requires both halves).
 */
export function ProfileDetailsSheet({
  visible,
  initialFirstName,
  initialLastName,
  initialGender,
  onClose,
  onSaved,
}: ProfileDetailsSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [gender, setGender] = useState<Gender | null>(initialGender);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateProfileDetails();

  useEffect(() => {
    if (visible) {
      setFirstName(initialFirstName);
      setLastName(initialLastName);
      setGender(initialGender);
      setError(null);
    }
  }, [visible, initialFirstName, initialLastName, initialGender]);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const canSave = trimmedFirst.length > 0 && trimmedLast.length > 0;

  const save = () => {
    setError(null);
    update.mutate(
      { firstName: trimmedFirst, lastName: trimmedLast, gender: gender ?? undefined },
      {
        onSuccess: (user) => onSaved(user),
        onError: (err) => setError(nameErrorMessage(err)),
      },
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
        Your details
      </AppText>

      <View style={styles.nameRow}>
        <View style={[styles.field, styles.nameField]}>
          <AppText variant="ui.label" tone="secondary">
            First name
          </AppText>
          <TextInput
            accessibilityLabel="First name"
            value={firstName}
            onChangeText={setFirstName}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />
        </View>
        <View style={[styles.field, styles.nameField]}>
          <AppText variant="ui.label" tone="secondary">
            Last name
          </AppText>
          <TextInput
            accessibilityLabel="Last name"
            value={lastName}
            onChangeText={setLastName}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.field}>
        <AppText variant="ui.label" tone="secondary">
          Gender
        </AppText>
        <View style={styles.genderRow}>
          {GENDER_OPTIONS.map((option) => {
            const active = option.value === gender;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: active }}
                onPress={() => setGender(option.value)}
                style={({ pressed }) => [styles.genderChip, active && styles.genderChipActive, pressed && styles.genderChipPressed]}
              >
                <AppText variant="ui.badge" tone={active ? 'gold' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton label="Save" disabled={!canSave} loading={update.isPending} onPress={save} />
        <View style={styles.cancel}>
          <LinkButton label="Cancel" onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  heading: {
    textTransform: 'uppercase',
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs,
  },
  nameField: {
    flex: 1,
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
  genderRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.lg,
    padding: 3,
    gap: 3,
  },
  genderChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  genderChipActive: {
    backgroundColor: colors.chip.square,
  },
  genderChipPressed: {
    opacity: 0.7,
  },
  error: {
    color: colors.status.rose.text,
  },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  cancel: {
    alignItems: 'center',
  },
}));
