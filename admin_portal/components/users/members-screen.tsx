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
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader, SegmentedControl } from "@/components/portal";
import { Avatar } from "@/components/portal/avatar";
import { Toast } from "@/components/portal/toast";
import { useSession } from "@/lib/auth/session-context";
import { clampPage } from "@/lib/format";
import { errorText } from "@/lib/users/error-text";
import {
  MEMBERS_PAGE_SIZE,
  toMemberStatus,
  useMembers,
  type MemberStatusFilter,
} from "@/lib/query/hooks/use-members";
import {
  useDeleteUser,
  useSetUserActive,
  type UserPublic,
} from "@/lib/query/hooks/use-users";
import { UserRowMenu } from "./user-row-menu";
import { UserStateCell } from "./user-state-cell";
import type { UserRowAction } from "./row-menu-items";

/* =============================================================================
   MembersScreen — Mobile users (admin only).

   The people who use the mobile app (role `viewer`), which the staff
   directory never lists. Search by email or name, filter by state, and per
   row: Deactivate (they're signed out and can't sign in; reversible),
   Reactivate, and — once deactivated — Remove, which deletes the account and
   its listening history, playlists, likes, comments and subscription record.

   Removing is deliberately hard to do by accident: it is only offered for a
   deactivated account, and the dialog needs the account's email typed in.
   The server enforces both rules (409 for an active account) and admin-only
   access regardless of this screen. URL is the state: `?q=&status=&page=`.
   ========================================================================== */

const STATUS_OPTIONS: ReadonlyArray<{ value: MemberStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
];

const TOAST_MS = 6000;
const SEARCH_DEBOUNCE_MS = 300;

function personLabel(row: UserPublic): string {
  return row.full_name?.trim() || row.email;
}

export function MembersScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const status = toMemberStatus(searchParams.get("status"));
  const pageParam = clampPage(searchParams.get("page"));

  const { items, total, page, pageCount, isPending, isError, error } = useMembers({
    q,
    status,
    page: pageParam,
  });

  const push = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Search box: local while typing, pushed to the URL after a short pause.
  const [draft, setDraft] = React.useState(q);
  const [syncedQ, setSyncedQ] = React.useState(q);
  if (q !== syncedQ) {
    // The URL changed under us (back button, a link): follow it.
    setSyncedQ(q);
    setDraft(q);
  }
  React.useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => push({ q: draft.trim() || undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, q, push]);

  const setActive = useSetUserActive();
  const deleteUser = useDeleteUser();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<UserPublic | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<UserPublic | null>(null);
  const [removeMessage, setRemoveMessage] = React.useState<string | null>(null);
  const [typedEmail, setTypedEmail] = React.useState("");

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const runSetActive = (row: UserPublic, isActive: boolean) => {
    setActionError(null);
    setActive.mutate(
      { id: row.id, isActive },
      {
        onSuccess: () => {
          setDeactivateTarget(null);
          setToast(isActive ? `Reactivated ${personLabel(row)}.` : `Deactivated ${personLabel(row)}.`);
        },
        onError: (err) => {
          setDeactivateTarget(null);
          setActionError(
            errorText(err, isActive ? "Couldn’t reactivate this account." : "Couldn’t deactivate this account."),
          );
        },
      },
    );
  };

  const closeRemove = () => {
    setRemoveTarget(null);
    setRemoveMessage(null);
    setTypedEmail("");
  };

  const runRemove = (row: UserPublic) => {
    setActionError(null);
    deleteUser.mutate(
      { id: row.id },
      {
        onSuccess: () => {
          closeRemove();
          setToast(`Removed ${personLabel(row)}.`);
        },
        onError: (err) => setRemoveMessage(errorText(err, "Couldn’t remove this account.")),
      },
    );
  };

  const handleRowAction = (row: UserPublic, action: UserRowAction) => {
    if (action === "deactivate") setDeactivateTarget(row);
    else if (action === "reactivate") runSetActive(row, true);
    else if (action === "remove") {
      setRemoveMessage(null);
      setTypedEmail("");
      setRemoveTarget(row);
    }
  };

  const busyRowId = setActive.isPending ? setActive.variables?.id : undefined;
  const emailMatches =
    removeTarget !== null && typedEmail.trim().toLowerCase() === removeTarget.email.toLowerCase();

  const columns: DataTableColumn<UserPublic>[] = [
    {
      key: "person",
      header: "Person",
      gridWidth: "2.4fr",
      cell: (row) => {
        const name = row.full_name?.trim() || null;
        const off = !row.is_active;
        return (
          <div className="flex min-w-0 items-center gap-11">
            <div className={off ? "opacity-60" : undefined}>
              <Avatar name={name ?? row.email} size={32} />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className={cn("truncate text-[14px] font-semibold", off ? "text-ink-muted" : "text-ink")}>
                {name ?? "—"}
              </span>
              <span className="truncate text-[12px] text-ink-faint">{row.email}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: "state",
      header: "State",
      gridWidth: "1fr",
      // Viewers have no invite step, so "pending" never applies.
      cell: (row) => <UserStateCell row={{ is_active: row.is_active, activated_at: row.created_at }} />,
    },
    {
      key: "joined",
      header: "Joined",
      gridWidth: "1fr",
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
      : `${(page - 1) * MEMBERS_PAGE_SIZE + 1}–${Math.min(page * MEMBERS_PAGE_SIZE, total)} of ${total}`;
  const filtered = q !== "" || status !== "all";

  return (
    <>
      <PageHeader
        title="Mobile users"
        subhead="People who use the mobile app. Deactivate an account to sign it out and block sign-in; remove a deactivated account to delete it and its data for good."
      />

      <div className="flex flex-col gap-12">
        <div className="flex flex-wrap items-center gap-10">
          <Input
            type="search"
            aria-label="Search by email or name"
            placeholder="Search by email or name"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            className="h-[34px] w-[min(320px,100%)] text-[13.5px]"
          />
          <SegmentedControl<MemberStatusFilter>
            aria-label="Filter by state"
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(value) => push({ status: value === "all" ? undefined : value })}
            className="w-fit"
          />
        </div>

        <div className="overflow-hidden rounded-16 border border-border bg-surface">
          {isError || actionError ? (
            <div className="flex flex-col gap-8 border-b border-border-subtle p-16">
              {isError ? (
                <Alert variant="error" title="Couldn’t load mobile users">
                  {error instanceof Error ? error.message : "Please try again."}
                </Alert>
              ) : null}
              {actionError ? (
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
              ) : null}
            </div>
          ) : null}

          <DataTable<UserPublic>
            className="rounded-none border-0"
            caption="Mobile users"
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            rowActions={(row) => (
              <UserRowMenu
                user={row}
                actor={{ id: session.id, role: session.role }}
                activeAdminCount={0}
                busy={busyRowId === row.id}
                onAction={(action) => handleRowAction(row, action)}
              />
            )}
            loading={isPending}
            rangeLabel={rangeLabel}
            page={page}
            pageCount={pageCount}
            onPageChange={(next) => push({ page: next <= 1 ? undefined : String(next) })}
            minWidth={640}
            empty={
              <EmptyState
                title={filtered ? "No one matches" : "No mobile users yet"}
                description={
                  filtered
                    ? "Try another search or clear the filter."
                    : "People appear here when they sign up in the app."
                }
              />
            }
          />
        </div>
      </div>

      <Dialog open={deactivateTarget !== null} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogTitle>Deactivate this account?</DialogTitle>
          <DialogDescription>
            {deactivateTarget
              ? `${personLabel(deactivateTarget)} (${deactivateTarget.email}) is signed out of the app and can’t sign in again until you reactivate the account. Nothing is deleted.`
              : null}
          </DialogDescription>
          <div className="flex items-center gap-8 pt-2">
            <Button
              type="button"
              variant="destructive"
              disabled={setActive.isPending}
              onClick={() => deactivateTarget && runSetActive(deactivateTarget, false)}
            >
              {setActive.isPending ? "Deactivating…" : "Deactivate"}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteUser.isPending) closeRemove();
        }}
      >
        <DialogContent className="w-[min(480px,calc(100vw-32px))]">
          <DialogTitle>Remove this account permanently?</DialogTitle>
          <DialogDescription>
            {removeTarget
              ? `${personLabel(removeTarget)}’s account is deleted along with their listening history, playlists, likes, comments and subscription record. This can’t be undone.`
              : null}
          </DialogDescription>
          <form
            className="flex flex-col gap-12"
            onSubmit={(event) => {
              event.preventDefault();
              if (removeTarget && emailMatches && !deleteUser.isPending) runRemove(removeTarget);
            }}
          >
            <label htmlFor="remove-member-email" className="text-[13.5px] text-ink">
              Type <span className="font-mono font-semibold">{removeTarget?.email}</span> to confirm
            </label>
            <Input
              id="remove-member-email"
              value={typedEmail}
              autoComplete="off"
              onChange={(e) => setTypedEmail(e.target.value)}
            />
            {removeMessage ? (
              <Alert variant="warning" title="Can’t remove this account">
                {removeMessage}
              </Alert>
            ) : null}
            <div className="flex items-center gap-8">
              <Button type="submit" variant="destructive" disabled={!emailMatches || deleteUser.isPending}>
                {deleteUser.isPending ? "Removing…" : "Remove account"}
              </Button>
              <Button type="button" variant="secondary" disabled={deleteUser.isPending} onClick={closeRemove}>
                Cancel
              </Button>
            </div>
          </form>
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
