/**
 * Client-side CSV of the Subscriptions table (plan §W21 item 4).
 *
 * Built from the rows currently loaded and filtered on screen — there is NO
 * server export endpoint. The file matches the visible filtered set exactly.
 *
 * Columns: member name, email, tier, status, renewal date. Deliberately:
 *
 *   - NO amount / price / currency column — no amount is stored anywhere and
 *     no dollar figure appears in the portal (plan decision 2, §A.3).
 *   - NO `provider_customer_id` column — the Stripe customer id is a
 *     row-action-only affordance and must not land in an exported spreadsheet
 *     of the whole membership (W20 security-review note in status.md).
 *
 * Status is the human label ("Past due", not "past_due") so the file reads the
 * same as the screen. The renewal date is `current_period_end` as a plain
 * `YYYY-MM-DD` (empty when null) — it is the renewal date in its own column
 * for every row, past-due included; it is never a dunning timestamp.
 */

import { SUBSCRIPTION_STATUS_LABEL } from "./subscription-status";
import type { SubscriptionAdminItem } from "@/lib/query/hooks/use-subscriptions";

export const SUBSCRIPTIONS_CSV_HEADERS = [
  "Member",
  "Email",
  "Tier",
  "Status",
  "Renewal date",
] as const;

/** RFC 4180: wrap in quotes and double any embedded quote when the value
    carries a comma, quote, CR or LF; otherwise pass it through. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function renewalDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function subscriptionRowToCsvCells(
  row: SubscriptionAdminItem,
): [string, string, string, string, string] {
  return [
    row.user_name?.trim() || "",
    row.user_email,
    row.tier,
    SUBSCRIPTION_STATUS_LABEL[row.status],
    renewalDate(row.current_period_end),
  ];
}

/**
 * The full CSV text for `rows`, in the order given. CRLF line endings (RFC
 * 4180); one header row plus one line per row. An empty `rows` yields just the
 * header line.
 */
export function subscriptionsToCsv(
  rows: readonly SubscriptionAdminItem[],
): string {
  const lines = [
    SUBSCRIPTIONS_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      subscriptionRowToCsvCells(row).map(csvField).join(","),
    ),
  ];
  return lines.join("\r\n");
}
