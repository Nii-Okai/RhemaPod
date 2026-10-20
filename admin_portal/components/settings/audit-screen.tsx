"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { clampPage } from "@/lib/format";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABEL,
  AUDIT_PAGE_SIZE,
  toCategory,
  toOutcome,
  useAuditLog,
  type AuditCategory,
  type AuditEntry,
  type AuditOutcome,
} from "@/lib/query/hooks/use-audit-log";

/* =============================================================================
   AuditScreen — Settings › Audit trail (plan-admin-settings S17, ADR 0018).

   Admin only, view only (D5: no export). One table over the unified feed
   (`audit_log` plus the sermon, announcement and comment-moderation history)
   with a filter bar: category, outcome, a date range, and "Staff actions
   only", which is ON by default (D6) — it's a filter, not a restriction, so
   unticking it adds viewer sign-ins and self-deletes. URL is the state.

   Each row shows the server-built summary; selecting a row opens a details
   dialog with the action, IP, browser and the raw details.
   ========================================================================== */

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
          rowKey={(row) => `${row.source}:${row.id}`}
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
