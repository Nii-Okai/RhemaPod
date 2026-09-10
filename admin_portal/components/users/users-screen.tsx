"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader, SegmentedControl } from "@/components/portal";
import { Avatar } from "@/components/portal/avatar";
import { Toast } from "@/components/portal/toast";
import { useSession } from "@/lib/auth/session-context";
import { clampPage } from "@/lib/format";
import { isApiError } from "@/lib/api/errors";
import { errorText } from "@/lib/users/error-text";
import {
  USERS_PAGE_SIZE,
  toRoleFilter,
  useChangeUserRole,
  useResendInvite,
  useSetUserActive,
  useUsers,
  type StaffRoleFilter,
  type UserPublic,
  type UserRole,
} from "@/lib/query/hooks/use-users";
import { InviteStaffDialog } from "./invite-staff-dialog";
import { RoleCell } from "./role-cell";
import { UserCountTiles } from "./user-count-tiles";
import { UserRowMenu } from "./user-row-menu";
import { UserStateCell } from "./user-state-cell";
import { userState } from "./user-state";
import type { UserRowAction } from "./row-menu-items";

/* =============================================================================
   UsersScreen — Users & roles (design Screen 10, plan W17 + W19).

   A thin read over existing endpoints + Batch 7: the `role-counts` tiles, a
   role filter (All / Editors / Managers / Admins — never Viewers), the W6
   `DataTable` of staff rows, an inline role change on editable rows, and the
   "Invite staff" dialog. URL is the state: `?role=` (the filter) and `?page=`.

   W19 adds the lifecycle affordances: a "State" column (Active / Deactivated /
   Invite pending — a text badge, never colour-only) and a `···` row menu with
   Deactivate (confirmation dialog on the destructive path), Reactivate, and
   Resend invite. The last-admin refusal (409) renders as an explanatory inline
   message inside the confirm dialog, not a generic toast; a deactivated row is
   greyed AND carries its text badge.

   The list is staff-only for every actor (plan §A.6) — a viewer never appears.
   ========================================================================== */

const ROLE_FILTER_OPTIONS: ReadonlyArray<{
  value: StaffRoleFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "editor", label: "Editors" },
  { value: "manager", label: "Managers" },
  { value: "admin", label: "Admins" },
];

/** The explanatory copy for the last-admin invariant (backend 409). Named here
    so it reads the same whatever the backend's `detail` string says, and so it
    is unmistakably NOT a generic failure toast (plan §W19 acceptance). */
const LAST_ADMIN_MESSAGE =
  "This is the last active admin — promote or reactivate another admin first.";

/** Auto-dismiss window for the success `Toast` (matches `review-screen.tsx`). */
const TOAST_MS = 6000;

/**
 * The deferred-revoke note. `PATCH …/active` returns `revocation_deferred: true`
 * when the state change committed but a Redis outage stopped a refresh-token
 * revoke from being recorded — set on BOTH paths (plan §W18 / schema):
 *
 *   deactivate  the lockout landed, but a still-live token isn't revoked yet
 *   reactivate  a pre-deactivation refresh token couldn't be force-expired (CWE-613)
 *
 * So the copy has to branch on the action: after a deferred deactivate the
 * account is OFF, after a deferred reactivate it is ON. It is a security signal,
 * so it is latched — a later unrelated set-active success (which carries
 * `revocation_deferred: false`) must not clear it; only an explicit dismiss
 * does — and it names the account it concerns.
 */
type DeferredRevokeNote = { name: string; action: "deactivate" | "reactivate" };

function deferredNoteTitle(note: DeferredRevokeNote): string {
  return note.action === "deactivate"
    ? `${note.name} is deactivated — existing sessions may take a moment to end`
    : `${note.name} is active again — an earlier session token may still linger`;
}

function deferredNoteBody(note: DeferredRevokeNote): string {
  return note.action === "deactivate"
    ? `The auth store was briefly unavailable, so ${note.name}'s open sessions close on their next request rather than immediately — a token issued before the change may keep working for a few minutes.`
    : `${note.name}'s account is back on. A session token issued before it was switched off may still work for a few minutes — the auth store was briefly unavailable, so that earlier token couldn't be force-expired.`;
}

function personLabel(row: UserPublic): string {
  return row.full_name?.trim() || row.email;
}

function resendErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    // The typed 409/429/503 rejections get bespoke copy, but still carry the
    // `correlation_id` support handle that `errorText()` appends everywhere
    // else on this screen, so a 503 is chase-able.
    const ref = err.correlationId ? ` (reference: ${err.correlationId})` : "";
    if (err.status === 409) {
      return `This account has already been activated — there is nothing to resend.${ref}`;
    }
    if (err.status === 429) {
      // 429 comes from the W18 rate limiter (3 resends / hour), even though the
      // OpenAPI response set for resend-invite only enumerates 409 + 503.
      return `This invite has been resent too many times. Try again later.${ref}`;
    }
    if (err.status === 503) {
      return `Couldn’t reach the invite service. Try again in a moment.${ref}`;
    }
  }
  return errorText(err, "Couldn’t resend the invite.");
}

function buildSearch(
  current: URLSearchParams,
  patch: { role?: StaffRoleFilter; page?: number },
): string {
  const next = new URLSearchParams(current.toString());
  if ("role" in patch) {
    if (!patch.role || patch.role === "all") next.delete("role");
    else next.set("role", patch.role);
    next.delete("page");
  }
  if ("page" in patch) {
    if (!patch.page || patch.page <= 1) next.delete("page");
    else next.set("page", String(patch.page));
  }
  return next.toString();
}

export function UsersScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const role = toRoleFilter(searchParams.get("role"));
  const pageParam = clampPage(searchParams.get("page"));

  const { items, total, page, pageCount, isPending, isError, error } = useUsers({
    role,
    page: pageParam,
  });

  const pushSearch = React.useCallback(
    (search: string) => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  // Clamp a stale deep page down to the last real one.
  React.useEffect(() => {
    if (pageCount > 0 && pageParam > pageCount) {
      pushSearch(buildSearch(searchParams, { page: pageCount }));
    }
  }, [pageParam, pageCount, pushSearch, searchParams]);

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [deferredNote, setDeferredNote] =
    React.useState<DeferredRevokeNote | null>(null);
  const [confirmTarget, setConfirmTarget] = React.useState<UserPublic | null>(
    null,
  );
  const [confirmMessage, setConfirmMessage] = React.useState<string | null>(
    null,
  );

  // Auto-dismiss the success toast (the deferred-revoke note is deliberately
  // NOT on a timer — it is latched until the operator dismisses it).
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const changeRole = useChangeUserRole();
  const setActive = useSetUserActive();
  const resendInvite = useResendInvite();

  // Active admins visible on this page — the last-admin client gate. The
  // backend 409 is the real invariant; this only hides an affordance that
  // would obviously fail.
  const activeAdminCount = items.filter(
    (u) => u.role === "admin" && u.is_active,
  ).length;

  const setRoleFilter = (next: StaffRoleFilter) =>
    pushSearch(buildSearch(searchParams, { role: next }));
  const setPage = (next: number) =>
    pushSearch(buildSearch(searchParams, { page: next }));

  const submitRoleChange = (row: UserPublic, next: UserRole) => {
    setActionError(null);
    changeRole.mutate(
      { id: row.id, role: next },
      {
        onError: (err) =>
          setActionError(errorText(err, "Couldn’t change the role.")),
      },
    );
  };

  const runSetActive = (row: UserPublic, isActive: boolean) => {
    setActionError(null);
    setActive.mutate(
      { id: row.id, isActive },
      {
        onSuccess: (res) => {
          if (!isActive) {
            setConfirmTarget(null);
            setConfirmMessage(null);
          }
          // Latch: only set the note on an actual deferred revoke, never clear
          // it here — a false flag on a later action must not erase a still-open
          // security signal. Dismissal is explicit (the note's own button).
          if (res.revocation_deferred) {
            setDeferredNote({
              name: personLabel(row),
              action: isActive ? "reactivate" : "deactivate",
            });
          }
          setToast(
            isActive
              ? `Reactivated ${personLabel(row)}.`
              : `Deactivated ${personLabel(row)}.`,
          );
        },
        onError: (err) => {
          if (!isActive) {
            // Keep the confirm dialog open and explain, in place, WHY —
            // the last-admin invariant (409) especially must read as a
            // reason, not a generic error (plan §W19 acceptance).
            setConfirmMessage(
              isApiError(err) && err.status === 409
                ? LAST_ADMIN_MESSAGE
                : errorText(err, "Couldn’t deactivate this account."),
            );
          } else {
            setActionError(
              errorText(err, "Couldn’t reactivate this account."),
            );
          }
        },
      },
    );
  };

  const runResend = (row: UserPublic) => {
    setActionError(null);
    resendInvite.mutate(
      { id: row.id },
      {
        onSuccess: () => setToast(`Invite resent to ${row.email}.`),
        onError: (err) => setActionError(resendErrorMessage(err)),
      },
    );
  };

  const handleRowAction = (row: UserPublic, action: UserRowAction) => {
    switch (action) {
      case "deactivate":
        setConfirmMessage(null);
        setConfirmTarget(row);
        break;
      case "reactivate":
        runSetActive(row, true);
        break;
      case "resend-invite":
        runResend(row);
        break;
    }
  };

  const pendingRoleChangeId = changeRole.isPending
    ? changeRole.variables?.id
    : undefined;
  const busyRowId =
    (setActive.isPending ? setActive.variables?.id : undefined) ??
    (resendInvite.isPending ? resendInvite.variables?.id : undefined);

  const columns: DataTableColumn<UserPublic>[] = [
    {
      key: "person",
      header: "Person",
      gridWidth: "2fr",
      cell: (row) => {
        const name = row.full_name?.trim() || null;
        const deactivated = userState(row) === "deactivated";
        return (
          <div className="flex min-w-0 items-center gap-11">
            <div className={deactivated ? "opacity-60" : undefined}>
              <Avatar name={name ?? row.email} size={32} />
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "truncate text-[14px] font-semibold",
                  deactivated ? "text-ink-muted" : "text-ink",
                )}
              >
                {name ?? "—"}
              </span>
              <span className="truncate text-[12px] text-ink-faint">
                {row.email}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      gridWidth: "1.1fr",
      cell: (row) => (
        <RoleCell
          row={row}
          actor={{ id: session.id, role: session.role }}
          pending={pendingRoleChangeId === row.id}
          onChange={(next) => submitRoleChange(row, next)}
        />
      ),
    },
    {
      key: "state",
      header: "State",
      gridWidth: "1fr",
      cell: (row) => <UserStateCell row={row} />,
    },
    {
      key: "joined",
      header: "Joined",
      gridWidth: "1.1fr",
      cell: (row) => (
        <span className="font-mono text-[12.5px] text-ink-muted tabular-nums">
          {row.created_at.slice(0, 10)}
        </span>
      ),
    },
  ];

  const rangeLabel =
    total === 0
      ? "0 of 0"
      : `${(page - 1) * USERS_PAGE_SIZE + 1}–${Math.min(
          page * USERS_PAGE_SIZE,
          total,
        )} of ${total}`;

  return (
    <>
      <PageHeader
        title="Users & roles"
        subhead="Staff accounts, invites and inline role changes. Invites work once and expire in 48 hours. The last admin can’t be demoted or deactivated."
        actions={<InviteStaffDialog actorRole={session.role} />}
      />

      <div className="flex flex-col gap-20">
        <UserCountTiles />

        <div className="flex flex-col gap-12">
          <SegmentedControl<StaffRoleFilter>
            aria-label="Filter staff by role"
            options={ROLE_FILTER_OPTIONS}
            value={role}
            onValueChange={setRoleFilter}
            className="w-fit"
          />

          <div className="overflow-hidden rounded-16 border border-border bg-surface">
            {(isError || actionError || deferredNote) && (
              <div className="flex flex-col gap-8 border-b border-border-subtle p-16">
                {isError && (
                  <Alert variant="error" title="Couldn’t load the staff list">
                    {error instanceof Error ? error.message : "Please try again."}
                  </Alert>
                )}
                {actionError && (
                  <Alert variant="error" title="That change didn’t go through">
                    <span className="flex items-center gap-10">
                      <span>{actionError}</span>
                      <button
                        type="button"
                        onClick={() => setActionError(null)}
                        className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                      >
                        Dismiss
                      </button>
                    </span>
                  </Alert>
                )}
                {deferredNote && (
                  <Alert
                    variant="warning"
                    title={deferredNoteTitle(deferredNote)}
                  >
                    <span className="flex items-center gap-10">
                      <span>{deferredNoteBody(deferredNote)}</span>
                      <button
                        type="button"
                        onClick={() => setDeferredNote(null)}
                        className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                      >
                        Dismiss
                      </button>
                    </span>
                  </Alert>
                )}
              </div>
            )}

            <DataTable<UserPublic>
              className="rounded-none border-0"
              caption="Staff accounts"
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              rowActions={(row) => (
                <UserRowMenu
                  user={row}
                  actor={{ id: session.id, role: session.role }}
                  activeAdminCount={activeAdminCount}
                  busy={busyRowId === row.id}
                  onAction={(action) => handleRowAction(row, action)}
                />
              )}
              loading={isPending}
              rangeLabel={rangeLabel}
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              minWidth={760}
              empty={
                <EmptyState
                  title={
                    role === "all"
                      ? "No staff yet"
                      : "No staff match this filter"
                  }
                  description={
                    role === "all"
                      ? "Invite an editor, manager or admin to get started."
                      : "Try a different role, or clear the filter."
                  }
                />
              }
            />
          </div>
        </div>
      </div>

      <Dialog
        open={confirmTarget != null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmTarget(null);
            setConfirmMessage(null);
          }
        }}
      >
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogTitle>Deactivate this account?</DialogTitle>
          <DialogDescription>
            {confirmTarget
              ? `${personLabel(confirmTarget)} (${confirmTarget.email}) will lose access immediately. Their name stays on anything they authored. You can reactivate the account later.`
              : null}
          </DialogDescription>

          {confirmMessage ? (
            <Alert variant="warning" title="Can’t deactivate this account">
              {confirmMessage}
            </Alert>
          ) : null}

          <div className="flex items-center gap-8 pt-2">
            <Button
              type="button"
              size="md"
              variant="destructive"
              disabled={setActive.isPending}
              onClick={() =>
                confirmTarget && runSetActive(confirmTarget, false)
              }
            >
              {setActive.isPending ? "Deactivating…" : "Deactivate"}
            </Button>
            <DialogClose asChild>
              <Button type="button" size="md" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </>
  );
}
