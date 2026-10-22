import React, { useState } from 'react';
import { Link } from 'expo-router';
import { AppText, LinkButton, PrimaryButton } from '../../components';
import { useAuth } from '../../lib/auth/AuthContext';
import { AuthScreen } from './_components/auth-screen';
import { CheckEmailBody } from './_components/check-email';
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

  const backToSignIn = (
    <Link href="/(auth)/sign-in" asChild>
      <LinkButton label="Back to sign in" />
    </Link>
  );

  if (sent) {
    return (
      <AuthScreen
        eyebrow="Reset link sent"
        heading="Check your email"
        subhead={GENERIC_SUCCESS}
        footer={backToSignIn}
      >
        <CheckEmailBody
          email={email.trim()}
          kind="reset"
          onResend={async () => {
            await forgotPassword(email.trim());
          }}
          onUseDifferentEmail={() => setSent(false)}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      heading="Forgot your password?"
      headingVariant="display.title"
      subhead="Enter the email you signed up with and we'll send you a link to set a new one."
      subheadVariant="ui.body"
      footer={backToSignIn}
    >
      <Field
        label="Email"
        icon="mail-outline"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        autoFocus
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
        fullWidth
      />

      <AppText variant="ui.badge" tone="tertiary">
        Signed up with Google or Apple? You can keep using that button to sign in, no password needed.
      </AppText>
    </AuthScreen>
  );
}
