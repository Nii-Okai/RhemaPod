"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/* =============================================================================
   ConfirmDestructiveDialog — the gate in front of an action that can't be
   undone (wiping the audit trail, resetting tables, wiping the database).

   Two things are asked for, and the confirm button stays disabled until both
   are there: the exact phrase typed in (so it can't be done on autopilot) and
   the admin's own password (so a stolen session alone isn't enough). The
   server checks both again; a wrong password comes back as `error` and the
   dialog stays open with what was typed, minus the password.
   ========================================================================== */

export interface ConfirmDestructiveDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in plain words. */
  description: React.ReactNode;
  /** Extra detail under the description (e.g. the tables affected). */
  children?: React.ReactNode;
  phrase: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { phrase: string; password: string }) => void;
}

export function ConfirmDestructiveDialog({
  open,
  title,
  description,
  children,
  phrase,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  const [typed, setTyped] = React.useState("");
  const [password, setPassword] = React.useState("");
  const phraseId = React.useId();
  const passwordId = React.useId();
  const matches = typed.trim() === phrase;
  const ready = matches && password.length > 0 && !pending;

  // A refused attempt clears the password field so it can't be resubmitted
  // blindly; the phrase stays.
  const [seenError, setSeenError] = React.useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setPassword("");
  }

  const close = () => {
    setTyped("");
    setPassword("");
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
        <form
          className="flex flex-col gap-12"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onConfirm({ phrase, password });
          }}
        >
          <label htmlFor={phraseId} className="text-[13.5px] text-ink">
            Type <span className="font-mono font-semibold">{phrase}</span> to confirm
          </label>
          <Input
            id={phraseId}
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
          <label htmlFor={passwordId} className="text-[13.5px] text-ink">
            Your password
          </label>
          <Input
            id={passwordId}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <Alert variant="error" title="Not done — nothing was changed">
              {error}
            </Alert>
          ) : null}
          <div className="flex justify-end gap-8">
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={!ready}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
