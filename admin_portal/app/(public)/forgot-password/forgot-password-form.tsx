"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { Field } from "../_components/field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    // The response is always the same generic shape — we never branch on it,
    // so that this page cannot be used to tell whether an address exists.
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
    setDone(true);
    setSubmitting(false);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-14">
        <Alert variant="success" title="Check your inbox">
          If that address belongs to a staff account, we&rsquo;ve sent a reset
          link. It is valid for a short time and can only be used once.
        </Alert>
        <Link
          href="/login"
          className="text-[13px] font-medium text-clay-600 hover:text-clay-700"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-14" onSubmit={onSubmit} noValidate>
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
      <Button
        type="submit"
        size="lg"
        className="w-full rounded-11"
        disabled={submitting}
      >
        {submitting ? "Sending…" : "Send reset link"}
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
