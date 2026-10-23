"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { Toast } from "@/components/portal/toast";
import { isApiError } from "@/lib/api/errors";
import { clampPage } from "@/lib/format";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABEL,
  AUDIT_PAGE_SIZE,
  toCategory,
  toOutcome,
  useAuditLog,
  useDeleteAuditEntries,
  useWipeAuditTrail,
  WIPE_AUDIT_PHRASE,
  type AuditCategory,
  type AuditEntry,
  type AuditOutcome,
} from "@/lib/query/hooks/use-audit-log";
import { ConfirmDestructiveDialog } from "./confirm-destructive-dialog";

/* =============================================================================
   AuditScreen — Settings › Audit trail (plan-admin-settings S17, ADR 0018).

   Admin only, view only (D5: no export). One table over the unified feed
   (`audit_log` plus the sermon, announcement and comment-moderation history)
   with a filter bar: category, outcome, a date range, and "Staff actions
   only", which is ON by default (D6) — it's a filter, not a restriction, so
   unticking it adds viewer sign-ins and self-deletes. URL is the state.

   Each row shows the server-built summary; selecting a row opens a details
   dialog with the action, IP, browser and the raw details.

   Clean-up: tick rows and "Delete" them, or "Wipe audit trail…" to remove
   every entry (typed phrase plus password). Only system-log entries can go;
   sermon and announcement review steps and comment moderation are the
   history of those records and stay (ticking one deletes nothing, and the
   bulk bar says how many of the ticked rows will be kept). Either clean-up
   leaves one entry saying who did it and when.
   ========================================================================== */

function errorText(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId ? `${err.detail} (reference: ${err.correlationId})` : err.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

const keyOf = (row: Pick<AuditEntry, "source" | "id">) => `${row.source}:${row.id}`;

const SELECT_CLASS = "h-[32px] rounded-9 border-border-strong pr-[30px] text-[13px]";
const DATE_CLASS = "h-[32px] w-[150px] rounded-9 text-[13px]";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function buildSearch(current: URLSearchParams, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (!("page" in patch)) next.delete("page");
  return next.toString();
}

export function AuditScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const category = toCategory(searchParams.get("category"));
  const outcome = toOutcome(searchParams.get("outcome"));
  // Absent means the default (on); only an explicit `staff=all` turns it off.
  const staffOnly = searchParams.get("staff") !== "all";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const pageParam = clampPage(searchParams.get("page"));

  const { items, total, page, pageCount, isPending, isError, error } = useAuditLog({
    category,
    outcome,
    staffOnly,
    from: from || undefined,
    to: to || undefined,
    page: pageParam,
  });

  const [selected, setSelected] = React.useState<AuditEntry | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const deleter = useDeleteAuditEntries();
  const wiper = useWipeAuditTrail();

  // Only system-log rows can be deleted; ticking anything else is ignored.
  const deletableIds = [...checked]
    .filter((key) => key.startsWith("audit_log:"))
    .map((key) => key.slice("audit_log:".length));
  const keptCount = checked.size - deletableIds.length;

  const runDelete = () => {
    deleter.mutate(deletableIds, {
      onSuccess: (res) => {
        setConfirmDelete(false);
        setChecked(new Set());
        setToast(`Deleted ${res.deleted} ${res.deleted === 1 ? "entry" : "entries"}.`);
      },
    });
  };

  const push = (patch: Record<string, string | undefined>) => {
    const search = buildSearch(searchParams, patch);
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: "when",
      header: "When (UTC)",
      gridWidth: "150px",
      cell: (row) => (
        <span className="font-mono text-[12.5px] text-ink-muted tabular-nums">
          {formatWhen(row.created_at)}
        </span>
      ),
    },
    {
      key: "summary",
      header: "What happened",
      gridWidth: "3fr",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] text-ink">{row.summary}</span>
          <span className="truncate font-mono text-[11.5px] text-ink-faint">{row.action}</span>
        </div>
      ),
    },
    {
      key: "actor",
      header: "By",
      gridWidth: "1.4fr",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-ink">{row.actor_label}</span>
          {row.actor_role ? (
            <span className="text-[11.5px] text-ink-faint">{row.actor_role}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      gridWidth: "110px",
      cell: (row) =>
        row.outcome === "failure" ? (
          <span className="text-[13px] font-semibold text-rose-text">Failed</span>
        ) : (
          <span className="text-[13px] text-ink-muted">OK</span>
        ),
    },
  ];

  const rangeLabel =
    total === 0
      ? "0 of 0"
      : `${(page - 1) * AUDIT_PAGE_SIZE + 1}–${Math.min(page * AUDIT_PAGE_SIZE, total)} of ${total}`;

  const filtered = category != null || outcome != null || from !== "" || to !== "";

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-10" data-slot="audit-filter-bar">
        <label className="flex items-center gap-8 text-[13px] text-ink">
          <Checkbox
            checked={staffOnly}
            onChange={(e) => push({ staff: e.target.checked ? undefined : "all" })}
          />
          Staff actions only
        </label>
        <div className="w-[190px]">
          <Select
            aria-label="Category"
            className={SELECT_CLASS}
            value={category ?? ""}
            onChange={(e) => push({ category: e.target.value || undefined })}
          >
            <option value="">All categories</option>
            {AUDIT_CATEGORIES.map((c: AuditCategory) => (
              <option key={c} value={c}>
                {AUDIT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[150px]">
          <Select
            aria-label="Outcome"
            className={SELECT_CLASS}
            value={outcome ?? ""}
            onChange={(e) => push({ outcome: (e.target.value as AuditOutcome) || undefined })}
          >
            <option value="">Any outcome</option>
            <option value="success">Succeeded</option>
            <option value="failure">Failed</option>
          </Select>
        </div>
        <label className="flex items-center gap-6 text-[13px] text-ink-muted">
          From
          <Input
            type="date"
            aria-label="From date"
            className={DATE_CLASS}
            value={from}
            onChange={(e) => push({ from: e.target.value || undefined })}
          />
        </label>
        <label className="flex items-center gap-6 text-[13px] text-ink-muted">
          To
          <Input
            type="date"
            aria-label="To date"
            className={DATE_CLASS}
            value={to}
            onChange={(e) => push({ to: e.target.value || undefined })}
          />
        </label>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-rose-text"
          onClick={() => {
            wiper.reset();
            setWipeOpen(true);
          }}
        >
          Wipe audit trail…
        </Button>
      </div>

      <div className="overflow-hidden rounded-16 border border-border bg-surface">
        {isError ? (
          <div className="border-b border-border-subtle p-16">
            <Alert variant="error" title="Couldn’t load the audit trail">
              {error instanceof Error ? error.message : "Please try again."}
            </Alert>
          </div>
        ) : null}
        <DataTable<AuditEntry>
          className="rounded-none border-0"
          caption="Audit trail"
          columns={columns}
          rows={items}
          rowKey={keyOf}
          selectable
          selectedKeys={checked}
          onSelectionChange={setChecked}
          bulkLabel={(count) =>
            keptCount > 0
              ? `${count} selected · ${keptCount} review/moderation ${keptCount === 1 ? "entry stays" : "entries stay"}`
              : `${count} selected`
          }
          bulkActions={
            <div className="flex items-center gap-8">
              <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deletableIds.length === 0 || deleter.isPending}
                onClick={() => {
                  deleter.reset();
                  setConfirmDelete(true);
                }}
              >
                Delete {deletableIds.length} {deletableIds.length === 1 ? "entry" : "entries"}…
              </Button>
            </div>
          }
          loading={isPending}
          rangeLabel={rangeLabel}
          page={page}
          pageCount={pageCount}
          onPageChange={(next) => push({ page: next <= 1 ? undefined : String(next) })}
          onRowClick={setSelected}
          minWidth={860}
          empty={
            <EmptyState
              title={filtered ? "Nothing matches these filters" : "No activity recorded yet"}
              description={
                filtered
                  ? "Try a wider date range or a different category."
                  : "Sign-ins, staff changes and settings edits appear here as they happen."
              }
            />
          }
        />
      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open && !deleter.isPending) setConfirmDelete(false);
        }}
      >
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogTitle>
            Delete {deletableIds.length} audit {deletableIds.length === 1 ? "entry" : "entries"}?
          </DialogTitle>
          <DialogDescription>
            They’re removed for good. One new entry records that you deleted them.
            {keptCount > 0
              ? ` ${keptCount} ticked review or moderation ${keptCount === 1 ? "entry is" : "entries are"} kept — ${keptCount === 1 ? "it belongs" : "they belong"} to a sermon, announcement or comment.`
              : ""}
          </DialogDescription>
          {deleter.isError ? (
            <Alert variant="error" title="Not deleted">
              {errorText(deleter.error, "Please try again.")}
            </Alert>
          ) : null}
          <div className="flex justify-end gap-8">
            <Button
              variant="secondary"
              size="sm"
              disabled={deleter.isPending}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={deleter.isPending} onClick={runDelete}>
              {deleter.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={wipeOpen}
        title="Wipe the audit trail?"
        description="Every sign-in, staff change, settings edit, export and import entry is deleted for good. Sermon and announcement review steps and comment moderation stay with their records. One new entry records that you wiped it."
        phrase={WIPE_AUDIT_PHRASE}
        confirmLabel="Wipe audit trail"
        pendingLabel="Wiping…"
        pending={wiper.isPending}
        error={wiper.isError ? errorText(wiper.error, "Please try again.") : null}
        onCancel={() => setWipeOpen(false)}
        onConfirm={({ phrase, password }) =>
          wiper.mutate(
            { confirm: phrase, password },
            {
              onSuccess: (res) => {
                setWipeOpen(false);
                setChecked(new Set());
                setToast(`Audit trail wiped (${res.deleted} ${res.deleted === 1 ? "entry" : "entries"}).`);
              },
            },
          )
        }
      />

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected ? (
          <DialogContent>
            <DialogTitle className="pr-32 text-[17px] font-semibold text-ink">
              {selected.summary}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-ink-muted">
              {formatWhen(selected.created_at)} UTC
            </DialogDescription>
            <dl className="grid grid-cols-[140px_1fr] gap-x-12 gap-y-8 text-[13px]">
              <dt className="text-ink-faint">Action</dt>
              <dd className="font-mono text-ink">{selected.action}</dd>
              <dt className="text-ink-faint">By</dt>
              <dd className="text-ink">
                {selected.actor_label}
                {selected.actor_role ? ` (${selected.actor_role})` : ""}
              </dd>
              {selected.target_label || selected.target_type ? (
                <>
                  <dt className="text-ink-faint">Target</dt>
                  <dd className="text-ink">
                    {selected.target_label ?? selected.target_type}
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-faint">Outcome</dt>
              <dd className="text-ink">{selected.outcome === "failure" ? "Failed" : "Succeeded"}</dd>
              <dt className="text-ink-faint">IP address</dt>
              <dd className="font-mono text-ink">{selected.ip ?? "—"}</dd>
              <dt className="text-ink-faint">Browser</dt>
              <dd className="break-all text-ink">{selected.user_agent ?? "—"}</dd>
            </dl>
            {Object.keys(selected.details ?? {}).length > 0 ? (
              <pre className="max-h-[320px] overflow-auto rounded-10 bg-surface-sunken p-12 font-mono text-[12px] whitespace-pre-wrap text-ink">
                {JSON.stringify(selected.details, null, 2)}
              </pre>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
