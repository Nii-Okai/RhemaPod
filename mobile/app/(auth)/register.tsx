import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { AppText, LinkButton, PrimaryButton } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { performAppleSignIn, useAppleSignInAvailable } from '../../lib/auth/appleSignIn';
import { performGoogleSignIn } from '../../lib/auth/googleSignIn';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';
import { OrDivider } from './_components/or-divider';
import { SocialSignInButton } from './_components/social-sign-in-button';
import { socialAuthErrorCopy, type SocialAuthErrorCopy, type SocialProvider } from './_components/socialAuthErrorCopy';

const MIN_PASSWORD_LENGTH = 12;

export default function RegisterScreen() {
  const styles = useStyles();
  const { register, signInWithGoogle, signInWithApple } = useAuth();
  const appleAvailable = useAppleSignInAvailable();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [socialSubmitting, setSocialSubmitting] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<SocialAuthErrorCopy | null>(null);

  async function onSubmit() {
    setFieldError(null);
    setErrorTitle(null);
    setErrorDetail(null);

    if (!email.trim() || !password) {
      setFieldError('Email and password are required.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      await register(email.trim(), password);
      // The new account confirms its email with a 6-digit code before it can sign in.
      router.replace({ pathname: '/(auth)/verify-email', params: { email: email.trim() } });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorTitle('Could not create your account');
        setErrorDetail(err.message);
      } else {
        setErrorTitle('Could not create your account');
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

  return (
    <AuthScreen heading="Create an account" subhead="Sign up to save your place and download sermons.">
      <View style={styles.fieldGroup}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
        />
        <View style={styles.passwordGroup}>
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
          <AppText variant="ui.badge" tone="tertiary">
            At least {MIN_PASSWORD_LENGTH} characters.
          </AppText>
        </View>
      </View>

      {fieldError ? <InlineAlert variant="error" title={fieldError} /> : null}
      {errorTitle ? (
        <InlineAlert variant="error" title={errorTitle}>
          {errorDetail}
        </InlineAlert>
      ) : null}

      <PrimaryButton
        label={submitting ? 'Creating account…' : 'Create account'}
        onPress={onSubmit}
        loading={submitting}
        fullWidth
      />

      <View style={styles.socialSection}>
        <OrDivider />

        {socialError ? (
          <InlineAlert variant="error" title={socialError.title}>
            {socialError.detail}
          </InlineAlert>
        ) : null}

        <View style={styles.socialStack}>
          <SocialSignInButton
            provider="google"
            label="Continue with Google"
            loading={socialSubmitting === 'google'}
            disabled={socialSubmitting !== null}
            onPress={onGooglePress}
          />
          {appleAvailable ? (
            <SocialSignInButton
              provider="apple"
              label="Continue with Apple"
              loading={socialSubmitting === 'apple'}
              disabled={socialSubmitting !== null}
              onPress={onApplePress}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <View style={styles.footerRow}>
          <AppText variant="ui.body" tone="secondary">
            Already have an account?
          </AppText>
          <Link href="/(auth)/sign-in" asChild>
            <LinkButton label="Sign in" />
          </Link>
        </View>
      </View>
    </AuthScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  fieldGroup: {
    gap: spacing.md,
  },
  passwordGroup: {
    gap: spacing.sm,
  },
  socialSection: {
    gap: spacing.lg,
  },
  socialStack: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.lg,
    alignItems: 'center',
  },
  footerDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
}));
