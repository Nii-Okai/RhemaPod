import React, { useState } from 'react';
import { Link } from 'expo-router';
import { LinkButton, PrimaryButton } from '../../components';
import { useAuth } from '../../lib/auth/AuthContext';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';

/**
 * The backend's `/auth/forgot-password` always answers the same generic 200
 * regardless of whether the email exists (`app/api/auth.py` — deliberately
 * not an account-enumeration oracle), mirrored here exactly as the admin
 * portal's BFF route does it (`admin_portal/app/api/auth/forgot-password/route.ts`
 * — same copy). Only a genuine network failure gets a different message;
 * that's not an enumeration signal, it means the request never left the
 * device.
 */
const GENERIC_SUCCESS = 'If that email exists, a reset link has been sent.';

export default function ForgotPasswordScreen() {
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<string | null>(null);

  async function onSubmit() {
    setFieldError(null);
    setNetworkErrorMessage(null);

    if (!email.trim()) {
      setFieldError('Enter your email.');
      return;
    }

    setSubmitting(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch {
      // Any failure that reaches here (network loss, malformed body, an
      // upstream 5xx) is not the enumeration case the backend already
      // handles generically at 200 — it means the request itself didn't
      // complete, which is fair to say plainly.
      setNetworkErrorMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      heading="Reset your password"
      subhead="Enter your email and we'll send you a link to reset your password."
    >
      {sent ? (
        <InlineAlert variant="success" title="Check your email">
          {GENERIC_SUCCESS}
        </InlineAlert>
      ) : (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />

          {fieldError ? <InlineAlert variant="error" title={fieldError} /> : null}
          {networkErrorMessage ? (
            <InlineAlert variant="error" title="Could not send reset link">
              {networkErrorMessage}
            </InlineAlert>
          ) : null}

          <PrimaryButton
            label={submitting ? 'Sending…' : 'Send reset link'}
            onPress={onSubmit}
            loading={submitting}
          />
        </>
      )}

      <Link href="/(auth)/sign-in" asChild>
        <LinkButton label="Back to sign in" />
      </Link>
    </AuthScreen>
  );
}
