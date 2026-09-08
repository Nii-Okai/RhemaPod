"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { Field } from "../_components/field";

const MIN_LENGTH = 12; // mirrors ResetPasswordRequest.new_password on the backend

export function SetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPwError(null);
    setConfirmError(null);

    if (!token) {
      setFormError(
        "This link is missing its token. Ask an admin to send a fresh invite.",
      );
      return;
    }
    if (password.length < MIN_LENGTH) {
      setPwError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setConfirmError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    let res: Response;
    try {
      res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
    } catch {
      setFormError("Could not reach the server. Check your connection.");
      setSubmitting(false);
      return;
    }

    if (res.ok) {
      // reset-password returns a message, not a token pair — go sign in.
      router.replace("/login?reset=success");
      return;
    }

    const body = (await res.json().catch(() => null)) as
      | { detail?: string; errors?: { field: string; message: string }[] }
      | null;

    if (res.status === 422 && body?.errors?.length) {
      const pw = body.errors.find(
        (e) => e.field === "new_password" || e.field === "password",
      );
      setPwError(pw?.message ?? "That password is not strong enough.");
    } else if (res.status === 400) {
      setFormError(
        body?.detail ??
          "This link is invalid or has already been used. Ask an admin for a new invite.",
      );
    } else {
      setFormError(body?.detail ?? "Something went wrong. Try again.");
    }
    setSubmitting(false);
  }

  return (
    <form className="flex flex-col gap-14" onSubmit={onSubmit} noValidate>
      {formError ? (
        <Alert variant="error" title="Could not set your password">
          {formError}
        </Alert>
      ) : null}

      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        error={pwError}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        id="confirm"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        error={confirmError}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <p className="text-[12px] text-ink-faint">
        At least {MIN_LENGTH} characters, with a mix of letters, numbers and
        symbols.
      </p>

      <Button
        type="submit"
        size="lg"
        className="w-full rounded-11"
        disabled={submitting}
      >
        {submitting ? "Setting password…" : "Set password"}
      </Button>

      <Link
        href="/login"
        className="text-[13px] font-medium text-clay-600 hover:text-clay-700"
      >
        Back to sign in
      </Link>
    </form>
  );
}
