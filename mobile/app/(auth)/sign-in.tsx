/* global __DEV__ */
import React, { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { AppText, LinkButton, PrimaryButton } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { performAppleSignIn, useAppleSignInAvailable } from '../../lib/auth/appleSignIn';
import { performGoogleSignIn } from '../../lib/auth/googleSignIn';
import { resetOnboardingSeen } from '../../lib/settings/onboardingSeen';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';
import { OrDivider } from './_components/or-divider';
import { SocialSignInButton } from './_components/social-sign-in-button';
import { retryWindowText, socialAuthErrorCopy, type SocialAuthErrorCopy, type SocialProvider } from './_components/socialAuthErrorCopy';

type ErrorKind = null | 'credentials' | 'rate' | 'generic';

export default function SignInScreen() {
  const styles = useStyles();
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const appleAvailable = useAppleSignInAvailable();
  const router = useRouter();

  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [socialSubmitting, setSocialSubmitting] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<SocialAuthErrorCopy | null>(null);

  async function onSubmit() {
    setFieldError(null);
    setErrorKind(null);
    setErrorDetail(null);

    if (!email.trim() || !password) {
      setFieldError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          // Correct password, but the account hasn't entered its sign-up code yet.
          router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim(), resend: '1' } });
        } else if (err.status === 401) {
          setErrorKind('credentials');
        } else if (err.status === 429) {
          setErrorKind('rate');
          setErrorDetail(retryWindowText(err.retryAfter));
        } else {
          setErrorKind('generic');
          setErrorDetail(err.message);
        }
      } else {
        setErrorKind('generic');
        setErrorDetail('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onGooglePress() {
    setSocialError(null);
    setSocialSubmitting('google');
    try {
      const idToken = await performGoogleSignIn();
      if (idToken === null) return; // user dismissed the native sheet — silent no-op
      await signInWithGoogle(idToken);
    } catch (err) {
      setSocialError(socialAuthErrorCopy(err, 'google'));
    } finally {
      setSocialSubmitting(null);
    }
  }

  async function onApplePress() {
    setSocialError(null);
    setSocialSubmitting('apple');
    try {
      const result = await performAppleSignIn();
      if (result === null) return; // user tapped Apple's own Cancel — silent no-op
      await signInWithApple(result.identityToken, result.rawNonce, result.authorizationCode, result.givenName, result.familyName);
    } catch (err) {
      setSocialError(socialAuthErrorCopy(err, 'apple'));
    } finally {
      setSocialSubmitting(null);
    }
  }

  async function onReplayOnboardingPress() {
    await resetOnboardingSeen();
    router.replace('/onboarding');
  }

  const socialButtons = (
    <View style={styles.socialStack}>
      <SocialSignInButton
        provider="google"
        label="Continue with Google"
        loading={socialSubmitting === 'google'}
        disabled={socialSubmitting !== null || submitting}
        onPress={onGooglePress}
      />
      {appleAvailable ? (
        <SocialSignInButton
          provider="apple"
          label="Continue with Apple"
          loading={socialSubmitting === 'apple'}
          disabled={socialSubmitting !== null || submitting}
          onPress={onApplePress}
        />
      ) : null}
      {socialError ? (
        <InlineAlert variant="error" title={socialError.title}>
          {socialError.detail}
        </InlineAlert>
      ) : null}
    </View>
  );

  return (
    <AuthScreen
      heading="Pick up where you left off"
      headingVariant="display.title"
      subhead="Sign in to your sermons and playlists."
      subheadVariant="ui.body"
      centerHeader
      centerBrand
      compactTop
      footer={
        <>
          <View style={styles.footerRow}>
            <AppText variant="ui.body" tone="secondary">
              New here?
            </AppText>
            <Link href="/(auth)/register" asChild>
              <LinkButton label="Create an account" />
            </Link>
          </View>
          {__DEV__ ? <LinkButton label="Dev: Replay onboarding" onPress={onReplayOnboardingPress} /> : null}
        </>
      }
    >
      {socialButtons}

      <OrDivider label="or with email" />

      <View style={styles.fieldGroup}>
        <Field
          label="Email"
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <View style={styles.passwordGroup}>
          <Field
            ref={passwordRef}
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
          <View style={styles.forgotRow}>
            <Link href="/(auth)/forgot-password" asChild>
              <LinkButton label="Forgot password?" />
            </Link>
          </View>
        </View>
      </View>

      {fieldError ? <InlineAlert variant="error" title={fieldError} /> : null}
      {errorKind === 'credentials' ? (
        <InlineAlert variant="error" title="That email and password don't match.">
          Check for typos, or reset your password.
        </InlineAlert>
      ) : null}
      {errorKind === 'rate' ? (
        <InlineAlert variant="warning" title="Too many sign-in attempts">
          {errorDetail}
        </InlineAlert>
      ) : null}
      {errorKind === 'generic' ? (
        <InlineAlert variant="error" title="Could not sign you in">
          {errorDetail}
        </InlineAlert>
      ) : null}

      <PrimaryButton
        label={submitting ? 'Signing in…' : 'Sign in'}
        onPress={onSubmit}
        loading={submitting}
        disabled={socialSubmitting !== null}
        fullWidth
      />
    </AuthScreen>
  );
}

const useStyles = createThemedStyles(() => ({
  fieldGroup: {
    gap: spacing.lg,
  },
  passwordGroup: {
    gap: spacing.sm,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  socialStack: {
    gap: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
}));
