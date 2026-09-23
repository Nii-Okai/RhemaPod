import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { LinkButton, PrimaryButton } from '../../components';
import { spacing } from '../../theme/spacing';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';

type ErrorKind = null | 'credentials' | 'rate' | 'generic';

/** Matches the admin portal login form's retry-window copy (login-form.tsx). */
function retryWindowText(retryAfter: string | null): string {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 90) return `Try again in about ${seconds} seconds.`;
    return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  return 'Wait a minute or so, then try again.';
}

export default function SignInScreen() {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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
        if (err.status === 401) {
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

  return (
    <AuthScreen heading="Welcome back" subhead="Sign in to keep listening where you left off.">
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
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />

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

      <PrimaryButton label={submitting ? 'Signing in…' : 'Sign in'} onPress={onSubmit} loading={submitting} />

      <View style={styles.links}>
        <Link href="/(auth)/register" asChild>
          <LinkButton label="Create an account" />
        </Link>
        <Link href="/(auth)/forgot-password" asChild>
          <LinkButton label="Forgot password?" />
        </Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
