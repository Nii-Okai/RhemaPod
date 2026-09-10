"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader, SegmentedControl } from "@/components/portal";
import { Avatar } from "@/components/portal/avatar";
import { useSession } from "@/lib/auth/session-context";
import { clampPage } from "@/lib/format";
import { errorText } from "@/lib/users/error-text";
import {
  USERS_PAGE_SIZE,
  toRoleFilter,
  useChangeUserRole,
  useUsers,
  type StaffRoleFilter,
  type UserPublic,
  type UserRole,
} from "@/lib/query/hooks/use-users";
import { InviteStaffDialog } from "./invite-staff-dialog";
import { RoleCell } from "./role-cell";
import { UserCountTiles } from "./user-count-tiles";

/* =============================================================================
   UsersScreen — Users & roles (design Screen 10, plan W17).

   A thin read over existing endpoints + Batch 7: the `role-counts` tiles, a
   role filter (All / Editors / Managers / Admins — never Viewers), the W6
   `DataTable` of staff rows, an inline role change on editable rows, and the
   "Invite staff" dialog. URL is the state: `?role=` (the filter) and `?page=`.

   The list is staff-only for every actor (plan §A.6) — a viewer never appears,
   so there is no viewer row to reconcile against the Viewers tile's real
   count. Deactivate / reactivate, resend-invite and the `···` row menu are
   W19 and are deliberately absent here.
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
  const changeRole = useChangeUserRole();

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

  const pendingRoleChangeId = changeRole.isPending
    ? changeRole.variables?.id
    : undefined;

  // Built inline each render (like the W6 DataTable's own `rowKey` consumers):
  // the array is three entries and DataTable re-derives only a grid-template
  // string from it, so there is nothing worth memoising and the cells always
  // close over the current session + in-flight row.
  const columns: DataTableColumn<UserPublic>[] = [
    {
      key: "person",
      header: "Person",
      gridWidth: "2fr",
      cell: (row) => {
        const name = row.full_name?.trim() || null;
        return (
          <div className="flex min-w-0 items-center gap-11">
            <Avatar name={name ?? row.email} size={32} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold text-ink">
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
      gridWidth: "1.4fr",
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
      : `${(page - 1) * USERS_PAGE_SIZE + 1}–${Math.min(
          page * USERS_PAGE_SIZE,
          total,
        )} of ${total}`;

  return (
    <>
      <PageHeader
        title="Users & roles"
        subhead="Staff accounts, invites and inline role changes. Invites work once and expire in 48 hours."
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
            {(isError || actionError) && (
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
              </div>
            )}

            <DataTable<UserPublic>
              className="rounded-none border-0"
              caption="Staff accounts"
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              loading={isPending}
              rangeLabel={rangeLabel}
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              minWidth={620}
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
    </>
  );
}
