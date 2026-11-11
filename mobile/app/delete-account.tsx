import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, LinkButton, PlatformIcon, type AppIconName } from '../components';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { useAuth } from '../lib/auth/AuthContext';
import { displayEmail } from '../lib/auth/displayEmail';
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

/** What goes, as the Daybreak list (canvas F4). */
const DELETED: { icon: AppIconName; label: string }[] = [
  { icon: 'person-outline', label: 'Your profile, photo and sign-in methods' },
  { icon: 'library-outline', label: 'Playlists, My List and likes' },
  { icon: 'chatbubble-outline', label: 'Your comments' },
  { icon: 'time-outline', label: 'Watch history, progress, settings and downloads on this device' },
];

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

  // Synchronous guards: state lags a render behind, so a fast second tap or a hardware back
  // during the request would slip through. `busy` stays true from the first press through the
  // post-204 wipe and navigation; only failure paths release it.
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => busy.current);
    return () => {
      mounted.current = false;
      sub.remove();
      setPassword('');
    };
  }, []);

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
      const credential = await performGoogleSignIn({ freshPicker: true });
      if (credential === null) return null;
      return credential.kind === 'id_token'
        ? { method: 'google', id_token: credential.idToken, apple_unavailable: skipApple }
        : { method: 'google', server_auth_code: credential.code, apple_unavailable: skipApple };
    }
    const result = await performAppleSignIn();
    if (result === null) return null;
    if (!result.authorizationCode) {
      setError({ kind: 'badRequest', message: "Apple didn't confirm the sign-in. Try again." });
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
    if (!method || busy.current) return;
    busy.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const body = await buildBody(method);
      if (body === null) {
        release(); // cancelled at the provider's own sheet, or no password
        return;
      }
      await deleteAccount(body);
    } catch (err) {
      const next = deletionErrorFor(err, method);
      release();
      if (!mounted.current) return;
      setError(next);
      setPassword('');
      setAppleFailures((n) => (next.kind === 'appleUnavailable' ? n + 1 : 0));
      // "Apple re-auth required": Apple was linked after this screen loaded.
      if (next.kind === 'conflict') void profileQuery.refetch();
      return;
    }
    // Deleted. Stay locked (busy + submitting) through the wipe and the redirect.
    await finishAccountDeletion();
    router.replace({ pathname: '/(auth)/sign-in', params: { deleted: '1' } });
  }

  function release() {
    busy.current = false;
    if (mounted.current) setSubmitting(false);
  }

  const showSteps = Boolean(profile && plan && !isStaff);
  const header = (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
      <CircleButton
        icon="chevron-back"
        accessibilityLabel="Back"
        disabled={submitting}
        onPress={() => (step === 'confirm' ? setStep('notice') : router.back())}
      />
      {showSteps ? (
        <AppText variant="ui.label" tone="tertiary">
          {step === 'notice' ? 'Step 1 of 2' : 'Step 2 of 2'}
        </AppText>
      ) : null}
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
        <View style={styles.titleBlock}>
          <AppText variant="display.hero" accessibilityRole="header">
            Delete your account?
          </AppText>
          <AppText variant="ui.bodyLarge" tone="secondary">
            This removes everything tied to {displayEmail(profile.email)}. It can't be undone.
          </AppText>
        </View>
        <View style={styles.section}>
          <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
            What's deleted
          </AppText>
          {DELETED.map((item) => (
            <View key={item.label} style={styles.listItem}>
              <View style={styles.listIcon}>
                <PlatformIcon name={item.icon} size={16} color={colors.status.rose.text} />
              </View>
              <AppText variant="ui.body" style={styles.listText}>
                {item.label}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="ui.label" tone="tertiary">
          Kept for a while: encrypted backups for up to 30 days, copies of comments someone reported for up
          to 90 days, and a security log of account events, without your email, for up to 365 days.
        </AppText>
        <View style={styles.subsCard}>
          <AppText variant="ui.bodyBold" style={styles.subsText}>
            Subscriptions aren't cancelled
          </AppText>
          <AppText variant="ui.label" style={styles.subsText}>
            Cancel any {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} subscription yourself first.
          </AppText>
          <LinkButton label="Manage subscriptions" onPress={() => void Linking.openURL(SUBSCRIPTIONS_URL)} />
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setStep('confirm')}
            style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
          >
            <AppText variant="ui.button" style={styles.dangerText}>
              Continue
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.keep, pressed && styles.pressed]}
          >
            <AppText variant="ui.button">Keep my account</AppText>
          </Pressable>
        </View>
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
        <AppText variant="display.hero" accessibilityRole="header">
          Confirm it's you
        </AppText>
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
            <ActivityIndicator color={colors.surface.app} />
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg + 4,
  },
  // Balances the back button so the step label sits centred.
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.lg,
  },
  titleBlock: {
    gap: spacing.sm + 2,
  },
  section: {
    gap: spacing.sm + 2,
  },
  eyebrow: {
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  listIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.rose.bg,
  },
  listText: {
    flex: 1,
  },
  // Daybreak (canvas F4): a wheat card for the store-subscription notice.
  subsCard: {
    gap: spacing.xs + 2,
    padding: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.verse.border,
    backgroundColor: colors.verse.bg,
    alignItems: 'flex-start',
  },
  subsText: {
    color: colors.verse.icon,
  },
  actions: {
    gap: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  danger: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    backgroundColor: colors.status.rose.text,
  },
  dangerText: {
    color: colors.surface.app,
  },
  keep: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    borderWidth: 1.5,
    borderColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
}));
