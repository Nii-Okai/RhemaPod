import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { LinkButton, PrimaryButton } from '../../components';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { AuthScreen } from './_components/auth-screen';
import { CheckEmailBody } from './_components/check-email';
import { CODE_LENGTH, CodeInput } from './_components/code-input';
import { InlineAlert } from './_components/inline-alert';
import { retryWindowText } from './_components/socialAuthErrorCopy';

/**
 * Email confirmation for email/password sign-ups. `/auth/register` emails a
 * 6-digit code; entering it here (`/auth/verify-email`) signs the user in, and
 * the root auth guard moves them into the app. Reached from register.tsx right
 * after sign-up, and from sign-in.tsx when `/auth/login` answers 403 for an
 * unconfirmed account (`resend=1`: that code may be long expired, so a fresh
 * one is sent on arrival, surfaced below as its own notice — distinct from
 * `CheckEmailBody`'s own "Resend email" control, which the user drives). Google/Apple
 * sign-ins never come here.
 */
export default function VerifyEmailScreen() {
  const { verifyEmail, resendVerification } = useAuth();
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrivalNotice, setArrivalNotice] = useState<string | null>(null);
  const sentOnArrival = useRef(false);

  useEffect(() => {
    if (params.resend !== '1' || !email || sentOnArrival.current) return;
    sentOnArrival.current = true;
    void (async () => {
      try {
        await resendVerification(email);
        setArrivalNotice(`We sent a new code to ${email}.`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          setError(`Too many codes requested. ${retryWindowText(err.retryAfter)}`);
        } else {
          setError('Could not send a new code. Check your connection and try again.');
        }
      }
    })();
    // Once on arrival only (the ref also guards StrictMode's double effect).
  }, []);

  async function onSubmit(submittedCode: string) {
    setError(null);
    const trimmed = submittedCode.trim();
    if (trimmed.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(email, trimmed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('That code is wrong or has expired. Check the email or send a new code.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError(`Too many attempts. ${retryWindowText(err.retryAfter)}`);
      } else {
        setError('Could not verify right now. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="One more step"
      heading="Confirm your email"
      subhead={`Enter the ${CODE_LENGTH}-digit code we sent to ${email || 'your email'}.`}
      footer={
        <Link href="/(auth)/sign-in" asChild>
          <LinkButton label="Back to sign in" />
        </Link>
      }
    >
      <CodeInput value={code} onChangeText={setCode} error={error} onComplete={onSubmit} />

      {arrivalNotice ? <InlineAlert variant="success" title={arrivalNotice} /> : null}

      <PrimaryButton
        label={submitting ? 'Verifying…' : 'Verify and continue'}
        onPress={() => onSubmit(code)}
        loading={submitting}
        fullWidth
      />

      <CheckEmailBody
        email={email}
        kind="code"
        onResend={async () => {
          await resendVerification(email);
        }}
      />
    </AuthScreen>
  );
}
