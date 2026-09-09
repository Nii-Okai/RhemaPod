"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getBrowserQueryClient } from "@/lib/query/provider";
import { queryKeys } from "@/lib/query/keys";

import { Field } from "../_components/field";

type ErrorKind = null | "credentials" | "rate" | "generic";

function retryWindowText(retryAfter: string | null): string {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds < 90) return `Try again in about ${seconds} seconds.`;
    return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  return "Wait a minute or so, then try again.";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const justSetPassword = params.get("reset") === "success";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKind(null);
    setErrorDetail(null);

    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
    } catch {
      setErrorKind("generic");
      setErrorDetail("Could not reach the server. Check your connection.");
      setSubmitting(false);
      return;
    }

    if (res.ok) {
      // The BFF has set rp_at / rp_rt on this response; navigate into the portal.
      // The browser QueryClient is a singleton that survives a sign-out, so a
      // new session must not inherit the previous user's cached nav counts —
      // drop every `nav` key so the sidebar refetches for this session.
      getBrowserQueryClient()?.invalidateQueries({
        queryKey: queryKeys.nav.all(),
      });
      router.replace("/");
      router.refresh();
      return;
    }

    if (res.status === 401) {
      setErrorKind("credentials");
    } else if (res.status === 429) {
      setErrorKind("rate");
      setErrorDetail(retryWindowText(res.headers.get("retry-after")));
    } else {
      setErrorKind("generic");
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      setErrorDetail(body?.detail ?? "Something went wrong. Try again.");
    }
    setSubmitting(false);
  }

  return (
    <form className="flex flex-col gap-14" onSubmit={onSubmit} noValidate>
      {justSetPassword ? (
        <Alert variant="success" title="Password set">
          Sign in with your new password.
        </Alert>
      ) : null}

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-8 text-[13px] text-ink-muted">
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Keep me signed in
        </label>
        <Link
          href="/forgot-password"
          className="text-[13px] font-medium text-clay-600 hover:text-clay-700"
        >
          Forgot password?
        </Link>
      </div>

      {errorKind === "credentials" ? (
        <Alert variant="error" title="That email and password don't match.">
          Check for typos, or reset your password.
        </Alert>
      ) : null}
      {errorKind === "rate" ? (
        <Alert variant="warning" title="Too many sign-in attempts">
          {errorDetail}
        </Alert>
      ) : null}
      {errorKind === "generic" ? (
        <Alert variant="error" title="Could not sign you in">
          {errorDetail}
        </Alert>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full rounded-11"
        disabled={submitting}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <Alert variant="warning" title="Portal access is invite-only">
        Ask an admin to send an invite — the link is valid for 48 hours and can
        only be used once.
      </Alert>
    </form>
  );
}
