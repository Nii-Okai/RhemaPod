/**
 * Audit trail — the Settings › Audit trail screen (plan-admin-settings S17).
 *
 *   useAuditLog({ category, staffOnly, outcome, from, to, page })
 *     GET /api/v1/admin/audit?... → Page[AuditEntry]
 *
 * Admin only (the route 404s below admin, FastAPI 403s). Read-only, so nothing
 * invalidates it; it goes stale after 30s. `staff_only` is always sent
 * explicitly: the screen defaults it on, and sending it keeps the wire honest
 * about which view the admin is looking at.
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { clampPage } from "@/lib/format";
import { queryKeys, type AuditListParams } from "@/lib/query/keys";

export type AuditEntry = components["schemas"]["AuditEntry"];
export type AuditPage = components["schemas"]["Page_AuditEntry_"];

export const AUDIT_PAGE_SIZE = 50;

export const AUDIT_CATEGORIES = [
  "auth",
  "users",
  "settings",
  "reports",
  "sermons",
  "announcements",
  "moderation",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  auth: "Sign-ins",
  users: "Staff accounts",
  settings: "Settings",
  reports: "Report exports",
  sermons: "Sermons",
  announcements: "Announcements",
  moderation: "Comment moderation",
};

export type AuditOutcome = "success" | "failure";

export interface AuditFilters {
  category?: AuditCategory;
  staffOnly: boolean;
  outcome?: AuditOutcome;
  /** `YYYY-MM-DD`, inclusive (UTC). */
  from?: string;
  /** `YYYY-MM-DD`, inclusive (UTC); sent as the next day, since the API is half-open. */
  to?: string;
  page: number;
}

export function toCategory(raw: string | null | undefined): AuditCategory | undefined {
  return AUDIT_CATEGORIES.includes(raw as AuditCategory) ? (raw as AuditCategory) : undefined;
}

export function toOutcome(raw: string | null | undefined): AuditOutcome | undefined {
  return raw === "success" || raw === "failure" ? raw : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The exact query the screen sends. Dates become UTC midnights; the
    inclusive `to` day is turned into the API's exclusive bound. */
export function auditQuery(filters: AuditFilters): AuditListParams {
  const page = clampPage(filters.page);
  return {
    staff_only: filters.staffOnly,
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.from && DATE_RE.test(filters.from)
      ? { from: `${filters.from}T00:00:00Z` }
      : {}),
    ...(filters.to && DATE_RE.test(filters.to)
      ? { to: `${nextDay(filters.to)}T00:00:00Z` }
      : {}),
    limit: AUDIT_PAGE_SIZE,
    offset: (page - 1) * AUDIT_PAGE_SIZE,
  };
}

export async function loadAuditLog(
  query: AuditListParams,
  client: ApiClient = api,
): Promise<AuditPage> {
  return unwrap(client.GET("/api/v1/admin/audit", { params: { query } }));
}

export function useAuditLog(filters: AuditFilters) {
  const query = auditQuery(filters);
  const result = useQuery({
    queryKey: queryKeys.settings.audit(query),
    queryFn: () => loadAuditLog(query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  return {
    items: result.data?.items ?? [],
    total,
    page: Math.min(clampPage(filters.page), pageCount),
    pageCount,
    isPending: result.isPending,
    isError: result.isError,
    error: result.error,
  };
}
