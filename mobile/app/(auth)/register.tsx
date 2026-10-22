import React, { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { Link } from 'expo-router';
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
import { MIN_PASSWORD_LENGTH, PasswordFlames } from './_components/password-flames';
import { SocialSignInButton } from './_components/social-sign-in-button';
import { socialAuthErrorCopy, type SocialAuthErrorCopy, type SocialProvider } from './_components/socialAuthErrorCopy';

export default function RegisterScreen() {
  const styles = useStyles();
  const { register, signInWithGoogle, signInWithApple } = useAuth();
  const appleAvailable = useAppleSignInAvailable();

  const passwordRef = useRef<TextInput>(null);
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
    <AuthScreen
      eyebrow="Join RhemaPod"
      heading="Start listening"
      subhead="Save your place, build playlists and download sermons for later."
      footer={
        <View style={styles.footerRow}>
          <AppText variant="ui.body" tone="secondary">
            Already have an account?
          </AppText>
          <Link href="/(auth)/sign-in" asChild>
            <LinkButton label="Sign in" />
          </Link>
        </View>
      }
    >
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
        <AppText variant="ui.badge" tone="tertiary" style={styles.socialNote}>
          Quickest way in, no confirmation email needed.
        </AppText>
        {socialError ? (
          <InlineAlert variant="error" title={socialError.title}>
            {socialError.detail}
          </InlineAlert>
        ) : null}
      </View>

      <OrDivider label="or sign up with email" />

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
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
          <PasswordFlames length={password.length} />
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
  socialStack: {
    gap: spacing.md,
  },
  socialNote: {
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
}));
