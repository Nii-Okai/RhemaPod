import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, LinkButton, PrimaryButton } from '../components';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { useAuth } from '../lib/auth/AuthContext';
import { performAppleSignIn, useAppleSignInAvailable } from '../lib/auth/appleSignIn';
import { performGoogleSignIn } from '../lib/auth/googleSignIn';
import {
  APPLE_FAILURES_BEFORE_FALLBACK,
  deleteAccount,
  deletionErrorFor,
  planReauth,
  type AccountDeletionRequest,
  type DeletionError,
  type DeletionMethod,
} from '../lib/auth/accountDeletion';
import { useCurrentUser } from '../lib/query/hooks/useProfile';
import { useChurchContent } from '../lib/query/hooks/useChurchSettings';
import { isComplianceContentPending } from '../lib/content/commentsCompliance';
import { Field } from './(auth)/_components/field';
import { InlineAlert } from './(auth)/_components/inline-alert';

const SUBSCRIPTIONS_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

const MANUAL_APPLE_REVOKE =
  Platform.OS === 'ios'
    ? 'Your Apple sign-in for RhemaPod won\'t be removed automatically. To remove it, open Settings, tap your name, then Sign-In & Security > Sign in with Apple > RhemaPod > Stop Using Apple ID.'
    : 'Your Apple sign-in for RhemaPod won\'t be removed automatically. To remove it, go to account.apple.com, then Sign-In and Security > Sign in with Apple > RhemaPod, and stop using it.';

const METHOD_LABEL: Record<DeletionMethod, string> = {
  apple: 'Confirm with Apple',
  google: 'Confirm with Google',
  password: 'Your password',
};

/**
 * Me > Delete account (ADR 0020; plans/plan-account-deletion-clients.md D12). Two steps:
 *
 *  1. what is deleted and what is kept, plus the store-subscription notice (there is no IAP
 *     client, so the app can't tell whether one is active: the notice always shows);
 *  2. one fresh proof and the red "Delete permanently" button. Apple first whenever Apple is
 *     linked and this device can do it, so the server can revoke the Apple grant; otherwise
 *     password, then Google (`planReauth`).
 *
 * A 403 here is a failed re-auth, never a dead session, so it stays on this screen. Only a
 * 204 signs the device out (`finishAccountDeletion` wipes tokens, caches and downloads).
 */
export default function DeleteAccountScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { finishAccountDeletion } = useAuth();
  const appleAvailable = useAppleSignInAvailable();
  const profileQuery = useCurrentUser();
  const { contactEmail } = useChurchContent();

  const [step, setStep] = useState<'notice' | 'confirm'>('notice');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<DeletionError | null>(null);
  const [appleFailures, setAppleFailures] = useState(0);
  // Chosen by the user after repeated Apple outages: a non-Apple proof plus
  // `apple_unavailable: true`. Revocation is skipped, re-auth never is.
  const [fallbackMethod, setFallbackMethod] = useState<DeletionMethod | null>(null);

  const profile = profileQuery.data;
  const plan = profile ? planReauth(profile, appleAvailable) : null;
  const method: DeletionMethod | null = fallbackMethod ?? plan?.primary ?? null;
  const skipApple = Boolean(plan?.appleLinked) && (fallbackMethod !== null || Boolean(plan?.skipAppleFromStart));
  const appleStalled = appleFailures >= APPLE_FAILURES_BEFORE_FALLBACK && fallbackMethod === null;
  const isStaff = profile ? profile.role !== 'viewer' : false;
  const contactPending = isComplianceContentPending(contactEmail);

  async function buildBody(m: DeletionMethod): Promise<AccountDeletionRequest | null> {
    if (m === 'password') {
      if (!password) {
        setError({ kind: 'reauth', message: 'Enter your password to continue.' });
        return null;
      }
      return { method: 'password', password, apple_unavailable: skipApple };
    }
    if (m === 'google') {
      const idToken = await performGoogleSignIn();
      return idToken === null ? null : { method: 'google', id_token: idToken, apple_unavailable: skipApple };
    }
    const result = await performAppleSignIn();
    if (result === null) return null;
    if (!result.authorizationCode) {
      setError({ kind: 'appleExpired', message: "Apple didn't confirm the sign-in. Try again." });
      return null;
    }
    return {
      method: 'apple',
      identity_token: result.identityToken,
      raw_nonce: result.rawNonce,
      authorization_code: result.authorizationCode,
      apple_unavailable: false,
    };
  }

  async function onDelete() {
    if (!method || submitting) return;
    setError(null);
    setSubmitting(true);
    let deleted = false;
    try {
      const body = await buildBody(method);
      if (body === null) return; // cancelled at the provider's own sheet, or no password
      await deleteAccount(body);
      deleted = true;
    } catch (err) {
      const next = deletionErrorFor(err, method);
      setError(next);
      setAppleFailures((n) => (next.kind === 'appleUnavailable' ? n + 1 : 0));
      // "Apple re-auth required": Apple was linked after this screen loaded.
      if (next.kind === 'conflict') void profileQuery.refetch();
    } finally {
      setSubmitting(false);
    }
    if (deleted) {
      await finishAccountDeletion();
      router.replace({ pathname: '/(auth)/sign-in', params: { deleted: '1' } });
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
      <IconButton
        icon="chevron-back"
        accessibilityLabel="Back"
        disabled={submitting}
        onPress={() => (step === 'confirm' ? setStep('notice') : router.back())}
      />
      <AppText variant="ui.bodyLarge" style={styles.headerTitle} accessibilityRole="header">
        Delete account
      </AppText>
      <View style={styles.headerSpacer} />
    </View>
  );

  const contactLink = contactPending ? null : (
    <LinkButton
      label={`Email ${contactEmail}`}
      onPress={() => void Linking.openURL(`mailto:${contactEmail}?subject=Delete%20my%20account`)}
    />
  );

  let body: React.ReactNode;
  if (profileQuery.isLoading) {
    body = <ActivityIndicator accessibilityLabel="Loading your account" color={colors.text.secondary} />;
  } else if (profileQuery.isError || !profile || !plan) {
    body = (
      <InlineAlert variant="error" title="Couldn't load your account.">
        Check your connection and try again.
      </InlineAlert>
    );
  } else if (isStaff) {
    body = (
      <InlineAlert variant="warning" title="Staff accounts are removed by an administrator.">
        Ask an admin to remove this account from the admin portal.
      </InlineAlert>
    );
  } else if (step === 'notice') {
    body = (
      <>
        <AppText variant="display.title">This can't be undone</AppText>
        <View style={styles.section}>
          <AppText variant="ui.label">What's deleted</AppText>
          <AppText variant="ui.body" tone="secondary">
            Your profile and photo, your sign-in methods, playlists, comments, likes, watch history and
            settings. Downloads on this device are removed too.
          </AppText>
        </View>
        <View style={styles.section}>
          <AppText variant="ui.label">What's kept for a while</AppText>
          <AppText variant="ui.body" tone="secondary">
            Encrypted backups for up to 30 days. Copies of comments someone reported, for up to 90 days. A
            security log of account events, without your email, for up to 365 days.
          </AppText>
        </View>
        <InlineAlert variant="warning" title="Subscriptions aren't cancelled">
          Deleting your account doesn't cancel a subscription bought through the{' '}
          {Platform.OS === 'ios' ? 'App Store' : 'Google Play Store'}. Cancel it there first.
        </InlineAlert>
        <LinkButton label="Manage subscriptions" onPress={() => void Linking.openURL(SUBSCRIPTIONS_URL)} />
        <PrimaryButton label="Continue" fullWidth onPress={() => setStep('confirm')} />
      </>
    );
  } else if (method === null) {
    // Apple-only account on a device that can't sign in with Apple.
    body = (
      <>
        <InlineAlert variant="warning" title="Apple is the only way into this account.">
          Delete it from an iPhone or iPad signed in to the same Apple ID, or ask us to delete it for you.
        </InlineAlert>
        {contactLink}
      </>
    );
  } else {
    body = (
      <>
        <AppText variant="display.title">Confirm it's you</AppText>
        <AppText variant="ui.body" tone="secondary">
          {method === 'apple'
            ? "Sign in with Apple once more. We'll also remove RhemaPod from your Apple ID."
            : method === 'google'
              ? 'Sign in with Google once more to confirm.'
              : 'Enter your password to confirm.'}
        </AppText>
        {method === 'password' ? (
          <Field
            label={METHOD_LABEL.password}
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={onDelete}
          />
        ) : null}
        {skipApple ? <InlineAlert variant="warning" title="Remove Apple sign-in yourself">{MANUAL_APPLE_REVOKE}</InlineAlert> : null}
        {error ? (
          <InlineAlert variant="error" title={error.message}>
            {error.kind === 'appleUnavailable' ? 'Nothing was deleted.' : undefined}
          </InlineAlert>
        ) : null}
        {appleStalled ? (
          plan.nonApple.length > 0 ? (
            <View style={styles.section}>
              <AppText variant="ui.body" tone="secondary">
                Apple isn't responding. You can delete your account without removing the Apple sign-in, and
                remove it yourself afterwards.
              </AppText>
              {plan.nonApple.map((m) => (
                <LinkButton
                  key={m}
                  label={m === 'password' ? 'Use my password instead' : 'Use Google instead'}
                  onPress={() => {
                    setError(null);
                    setFallbackMethod(m);
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.section}>
              <AppText variant="ui.body" tone="secondary">
                Apple isn't responding. Try again later, or ask us to delete your account.
              </AppText>
              {contactLink}
            </View>
          )
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={method === 'password' ? 'Delete permanently' : `Delete permanently, ${METHOD_LABEL[method]}`}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          disabled={submitting}
          onPress={onDelete}
          style={({ pressed }) => [styles.danger, (pressed || submitting) && styles.pressed]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.status.rose.text} />
          ) : (
            <AppText variant="ui.button" style={styles.dangerText}>
              {method === 'password' ? 'Delete permanently' : `${METHOD_LABEL[method]} and delete`}
            </AppText>
          )}
        </Pressable>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  // Balances the back button's width so the centered title is actually centered.
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  danger: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.status.rose.border,
    backgroundColor: colors.status.rose.bg,
  },
  dangerText: {
    color: colors.status.rose.text,
  },
  pressed: {
    opacity: 0.7,
  },
}));
