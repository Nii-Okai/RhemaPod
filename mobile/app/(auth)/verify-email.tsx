import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { LinkButton, PrimaryButton } from '../../components';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError } from '../../lib/api/errors';
import { AuthScreen } from './_components/auth-screen';
import { Field } from './_components/field';
import { InlineAlert } from './_components/inline-alert';
import { retryWindowText } from './_components/socialAuthErrorCopy';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Email confirmation for email/password sign-ups. `/auth/register` emails a
 * 6-digit code; entering it here (`/auth/verify-email`) signs the user in, and
 * the root auth guard moves them into the app. Reached from register.tsx right
 * after sign-up, and from sign-in.tsx when `/auth/login` answers 403 for an
 * unconfirmed account (`resend=1`: that code may be long expired, so a fresh
 * one is sent on arrival). Google/Apple sign-ins never come here.
 */
export default function VerifyEmailScreen() {
  const { verifyEmail, resendVerification } = useAuth();
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnArrival = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      await resendVerification(email);
      setNotice(`We sent a new code to ${email}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(`Too many codes requested. ${retryWindowText(err.retryAfter)}`);
      } else {
        setError('Could not send a new code. Check your connection and try again.');
      }
    }
  }

  useEffect(() => {
    if (params.resend === '1' && email && !sentOnArrival.current) {
      sentOnArrival.current = true;
      void onResend();
    }
    // Once on arrival only (the ref also guards StrictMode's double effect).
  }, []);

  async function onSubmit() {
    setError(null);
    setNotice(null);
    const trimmed = code.trim();
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
      heading="Confirm your email"
      subhead={`Enter the ${CODE_LENGTH}-digit code we sent to ${email || 'your email'}.`}
    >
      <Field
        label="Verification code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />

      {error ? <InlineAlert variant="error" title={error} /> : null}
      {notice ? <InlineAlert variant="success" title={notice} /> : null}

      <PrimaryButton
        label={submitting ? 'Verifying…' : 'Verify and continue'}
        onPress={onSubmit}
        loading={submitting}
        fullWidth
      />

      <LinkButton
        label={cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
        onPress={onResend}
        disabled={cooldown > 0 || !email}
      />

      <Link href="/(auth)/sign-in" asChild>
        <LinkButton label="Back to sign in" />
      </Link>
    </AuthScreen>
  );
}
