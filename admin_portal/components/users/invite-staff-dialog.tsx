"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EditorField } from "@/components/sermons/editor/field";
import { errorText } from "@/lib/users/error-text";
import { creatableRoles, type StaffRole } from "@/lib/users/role-policy";
import {
  useInviteStaff,
  type StaffCreateResponse,
} from "@/lib/query/hooks/use-users";

/* =============================================================================
   InviteStaffDialog — the "Invite staff" affordance on Users & roles
   (design Screen 10).

   `POST /api/v1/users` creates the account AND sends the set-password invite
   transactionally (plan §A.6) — a 5xx means nothing was created. Email + role
   (+ optional name); the role options are only what the caller may assign
   (`creatableRoles` — a manager can invite editors only). A blank/invalid
   email blocks submit with an inline field error and fires no request. Any
   failure — a duplicate-email 400, an invite-send 400, a 5xx — surfaces as an
   `<Alert>` at the top of the form and the dialog stays open with the typed
   values (design §Errors: an alert that survives, not a toast). On success the
   dialog closes and the hook invalidates the `users` domain so the new row and
   the tiles refetch.
   ========================================================================== */

const ROLE_LABEL: Record<StaffRole, string> = {
  editor: "Editor",
  manager: "Manager",
  admin: "Admin",
};

// Deliberately loose — the backend is the authority on email validity (and
// answers a bad address with a 422 the alert will show). This only stops an
// obviously-empty submit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteStaffDialogProps {
  /** The signed-in user's role — bounds the assignable role options. */
  actorRole: string;
  onInvited?: (result: StaffCreateResponse) => void;
}

export function InviteStaffDialog({
  actorRole,
  onInvited,
}: InviteStaffDialogProps) {
  const roles = creatableRoles(actorRole);
  const defaultRole: StaffRole = roles[0] ?? "editor";

  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [role, setRole] = React.useState<StaffRole>(defaultRole);
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);

  const invite = useInviteStaff();

  const emailInvalid = !EMAIL_RE.test(email.trim());
  const emailError =
    emailTouched && emailInvalid ? "Enter a valid email address." : null;

  const reset = () => {
    setEmail("");
    setFullName("");
    setRole(defaultRole);
    setEmailTouched(false);
    setAlert(null);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setAlert(null);
    if (emailInvalid) {
      setEmailTouched(true);
      return;
    }
    invite.mutate(
      { email: email.trim(), full_name: fullName.trim() || null, role },
      {
        onSuccess: (result) => {
          onInvited?.(result);
          setOpen(false);
          reset();
        },
        onError: (err) =>
          setAlert(errorText(err, "Couldn’t send the invite.")),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="md">Invite staff</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogTitle>Invite a staff member</DialogTitle>
        <DialogDescription>
          They get an email invite to set their own password. The link works
          once and expires in 48 hours.
        </DialogDescription>

        {alert ? (
          <Alert variant="error" title="That didn’t go through">
            {alert}
          </Alert>
        ) : null}

        <form
          className="flex flex-col gap-14"
          onSubmit={handleSubmit}
          noValidate
        >
          <EditorField label="Email" htmlFor="invite-email" error={emailError}>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              error={Boolean(emailError)}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder="name@church.org"
            />
          </EditorField>

          <EditorField label="Role" htmlFor="invite-role">
            <Select
              id="invite-role"
              value={role}
              disabled={roles.length <= 1}
              onChange={(e) => setRole(e.target.value as StaffRole)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </EditorField>

          <EditorField label="Full name (optional)" htmlFor="invite-name">
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ada Nwosu"
            />
          </EditorField>

          <div className="flex items-center gap-8 pt-2">
            <Button type="submit" size="md" disabled={invite.isPending}>
              {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
            <DialogClose asChild>
              <Button type="button" size="md" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
