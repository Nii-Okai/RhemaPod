import React, { useState } from 'react';
import { Link } from 'expo-router';
import { AppText, LinkButton, PrimaryButton } from '../../components';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';

const MIN_PASSWORD_LENGTH = 12;

export default function RegisterScreen() {
  const { register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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

  return (
    <AuthScreen heading="Create an account" subhead="Sign up to save your place and download sermons.">
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
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      <AppText variant="ui.badge" tone="tertiary">
        At least {MIN_PASSWORD_LENGTH} characters.
      </AppText>

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
      />

      <Link href="/(auth)/sign-in" asChild>
        <LinkButton label="Already have an account? Sign in" />
      </Link>
    </AuthScreen>
  );
}
