import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText, Avatar, PrimaryButton, Sheet } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
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
  /** Shown at the top of the sheet (canvas F2). The photo itself is changed from the
   * profile card on the You page, so this one is display-only. */
  avatarName?: string;
  avatarSeed?: string;
  avatarUrl?: string | null;
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
  avatarName,
  avatarSeed,
  avatarUrl,
}: ProfileDetailsSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [gender, setGender] = useState<Gender | null>(initialGender);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<'first' | 'last' | null>(null);
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
      <View style={styles.topBar}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={spacing.sm}
          style={styles.cancel}
        >
          <AppText variant="ui.body">Cancel</AppText>
        </Pressable>
        <AppText variant="display.row" accessibilityRole="header" style={styles.heading}>
          Your details
        </AppText>
        <View style={styles.cancel} />
      </View>

      <View style={styles.avatar}>
        <Avatar
          name={avatarName || `${firstName} ${lastName}`}
          seed={avatarSeed}
          imageUri={avatarUrl}
          size={96}
        />
      </View>

      <View style={styles.nameRow}>
        <View style={[styles.field, styles.nameField]}>
          <AppText variant="ui.label" tone="secondary">
            First name
          </AppText>
          <TextInput
            accessibilityLabel="First name"
            value={firstName}
            onChangeText={setFirstName}
            onFocus={() => setFocused('first')}
            onBlur={() => setFocused(null)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            placeholderTextColor={colors.text.tertiary}
            selectionColor={colors.iris.fill}
            style={[styles.input, focused === 'first' && styles.inputFocused]}
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
            onFocus={() => setFocused('last')}
            onBlur={() => setFocused(null)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            placeholderTextColor={colors.text.tertiary}
            selectionColor={colors.iris.fill}
            style={[styles.input, focused === 'last' && styles.inputFocused]}
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
                <AppText variant="ui.bodyBold" style={active ? styles.genderTextActive : null}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AppText variant="ui.label" tone="tertiary">
        Comments show your first name and last initial, never your email.
      </AppText>

      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton label="Save" fullWidth disabled={!canSave} loading={update.isPending} onPress={save} />
      </View>
    </Sheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // Daybreak (canvas F2): Cancel on the left, the Fraunces title centred.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: {
    minWidth: 56,
    minHeight: 44,
    justifyContent: 'center',
  },
  heading: {
    flex: 1,
    textAlign: 'center',
  },
  avatar: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  field: {
    gap: spacing.xs + 2,
  },
  nameField: {
    flex: 1,
  },
  input: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 16,
  },
  inputFocused: {
    borderColor: colors.iris.fill,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  genderChip: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border.default,
  },
  // Selected is an ink tile, like the add-to-playlist sheet's Done pill.
  genderChipActive: {
    backgroundColor: colors.text.primary,
    borderColor: colors.text.primary,
  },
  genderTextActive: {
    color: colors.surface.app,
  },
  genderChipPressed: {
    opacity: 0.7,
  },
  error: {
    color: colors.status.rose.text,
  },
  actions: {
    marginTop: spacing.xs,
  },
}));
