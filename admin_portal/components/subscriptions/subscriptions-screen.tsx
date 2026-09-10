"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/portal/data-table";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader, TierChip } from "@/components/portal";
import { Avatar } from "@/components/portal/avatar";
import { clampPage } from "@/lib/format";
import {
  SUBSCRIPTIONS_PAGE_SIZE,
  toStatusFilter,
  toTierFilter,
  useSubscriptions,
  type SubscriptionAdminItem,
  type SubscriptionStatus,
  type SubscriptionTier,
} from "@/lib/query/hooks/use-subscriptions";
import { SubscriptionCountTiles } from "./subscription-count-tiles";
import { SubscriptionStatusBadge } from "./subscription-status-badge";
import { SubscriptionsFilterBar } from "./subscriptions-filter-bar";
import { subscriptionsToCsv } from "./subscriptions-csv";

/* =============================================================================
   SubscriptionsScreen — Subscriptions (design Screen 9, plan W21).

   A pure read: three stat tiles, a status + tier filter, the W6 `DataTable` of
   paying members, a client-built CSV of the loaded/filtered rows, and an
   "Open in Stripe" deep link per row. URL is the state — `?status=` / `?tier=`
   and `?page=`.

   Read-only, and nothing here mutates a subscription (plan §A.3 / §W21). There
   is no cancel, refund, plan-change, retry or sync — every mutating operation
   lives in the Stripe dashboard, which owns the audit trail and the permissions
   model. The only outbound affordance is the external "Open in Stripe" link,
   and the only write of any kind is the browser download of the CSV.

   The subhead states the lag: this list follows the last billing update the
   provider sent us, so a member fixed by hand in Stripe reads their old status
   here for a few minutes.

   No dollar figure appears anywhere on this screen — no amount tile, no amount
   column, no amount in the CSV (plan decision 2).
   ========================================================================== */

const SUBHEAD =
  "This list updates when the payment provider sends us a change. If you fix a member’s card directly in Stripe, it can take a few minutes to show here. Past-due members keep access while the card is retried.";

/** The Stripe dashboard deep link for a customer. `provider_customer_id` is the
    Stripe customer id (`cus_…`); the row action is hidden entirely when it is
    null, never rendered disabled (plan §A.3). */
export function stripeCustomerUrl(providerCustomerId: string): string {
  return `https://dashboard.stripe.com/customers/${encodeURIComponent(
    providerCustomerId,
  )}`;
}

function memberName(row: SubscriptionAdminItem): string | null {
  return row.user_name?.trim() || null;
}

/**
 * The CSV filename. Encodes the active filter, and — because the export is the
 * loaded page only, never a fetch-all (plan §W21) — the page number whenever
 * more than one page exists, so a partial file is never mistaken for the whole
 * membership: `subscriptions-past_due-p2.csv`.
 */
function csvFilename(filter: {
  status?: SubscriptionStatus;
  tier?: SubscriptionTier;
  page: number;
  pageCount: number;
}): string {
  const parts = ["subscriptions"];
  if (filter.status) parts.push(filter.status);
  if (filter.tier) parts.push(filter.tier);
  if (filter.pageCount > 1) parts.push(`p${filter.page}`);
  return `${parts.join("-")}.csv`;
}

function buildSearch(
  current: URLSearchParams,
  patch: {
    status?: SubscriptionStatus;
    tier?: SubscriptionTier;
    page?: number;
  },
): string {
  const next = new URLSearchParams(current.toString());
  if ("status" in patch) {
    if (patch.status) next.set("status", patch.status);
    else next.delete("status");
    next.delete("page");
  }
  if ("tier" in patch) {
    if (patch.tier) next.set("tier", patch.tier);
    else next.delete("tier");
    next.delete("page");
  }
  if ("page" in patch) {
    if (!patch.page || patch.page <= 1) next.delete("page");
    else next.set("page", String(patch.page));
  }
  return next.toString();
}

export function SubscriptionsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = toStatusFilter(searchParams.get("status"));
  const tier = toTierFilter(searchParams.get("tier"));
  const pageParam = clampPage(searchParams.get("page"));

  const { items, total, page, pageCount, isPending, isError, error } =
    useSubscriptions({ status, tier, page: pageParam });

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

  const setStatus = (next: SubscriptionStatus | undefined) =>
    pushSearch(buildSearch(searchParams, { status: next }));
  const setTier = (next: SubscriptionTier | undefined) =>
    pushSearch(buildSearch(searchParams, { tier: next }));
  const setPage = (next: number) =>
    pushSearch(buildSearch(searchParams, { page: next }));

  const handleDownloadCsv = React.useCallback(() => {
    const csv = subscriptionsToCsv(items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFilename({ status, tier, page, pageCount });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [items, status, tier, page, pageCount]);

  const columns: DataTableColumn<SubscriptionAdminItem>[] = [
    {
      key: "member",
      header: "Member",
      gridWidth: "2fr",
      cell: (row) => {
        const name = memberName(row);
        return (
          <div className="flex min-w-0 items-center gap-11">
            <Avatar name={name ?? row.user_email} size={32} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold text-ink">
                {name ?? "—"}
              </span>
              <span className="truncate text-[12px] text-ink-faint">
                {row.user_email}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "tier",
      header: "Tier",
      gridWidth: "1fr",
      cell: (row) => (
        <TierChip
          tier={row.tier === "free" ? "free" : "paid"}
          label={row.tier.toUpperCase()}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      gridWidth: "1.1fr",
      cell: (row) => <SubscriptionStatusBadge status={row.status} />,
    },
    {
      key: "renewal",
      header: "Renewal date",
      gridWidth: "1.1fr",
      cell: (row) => (
        <span className="font-mono text-[12.5px] text-ink-muted tabular-nums">
          {row.current_period_end
            ? row.current_period_end.slice(0, 10)
            : "—"}
        </span>
      ),
    },
    {
      key: "stripe",
      header: "",
      gridWidth: "1fr",
      align: "end",
      // Hidden — not rendered — when there is no Stripe customer id (plan §A.3).
      // Never a disabled control: a disabled link is a promise that something
      // is temporarily unavailable, and a free / never-paid row will never
      // acquire a customer id without also acquiring the link via webhook.
      cell: (row) =>
        row.provider_customer_id ? (
          <a
            href={stripeCustomerUrl(row.provider_customer_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
          >
            Open in Stripe
          </a>
        ) : null,
    },
  ];

  const rangeLabel =
    total === 0
      ? "0 of 0"
      : `${(page - 1) * SUBSCRIPTIONS_PAGE_SIZE + 1}–${Math.min(
          page * SUBSCRIPTIONS_PAGE_SIZE,
          total,
        )} of ${total}`;

  const filtered = status != null || tier != null;

  return (
    <div className="flex flex-col gap-20">
      <PageHeader title="Subscriptions" subhead={SUBHEAD} />

      <SubscriptionCountTiles />

      <div className="flex flex-col gap-12">
        <SubscriptionsFilterBar
          status={status}
          tier={tier}
          onStatusChange={setStatus}
          onTierChange={setTier}
          onDownloadCsv={handleDownloadCsv}
          csvRowCount={items.length}
          page={page}
          pageCount={pageCount}
        />

        <div className="overflow-hidden rounded-16 border border-border bg-surface">
          {isError ? (
            <div className="border-b border-border-subtle p-16">
              <Alert variant="error" title="Couldn’t load the subscriptions">
                {error instanceof Error ? error.message : "Please try again."}
              </Alert>
            </div>
          ) : null}

          <DataTable<SubscriptionAdminItem>
            className="rounded-none border-0"
            caption="Paying members"
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            loading={isPending}
            rangeLabel={rangeLabel}
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            minWidth={820}
            empty={
              <EmptyState
                title={
                  filtered
                    ? "No subscriptions match this filter"
                    : "No subscriptions yet"
                }
                description={
                  filtered
                    ? "Try a different status or tier, or clear the filter."
                    : "Members appear here once they subscribe in the app."
                }
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
