/**
 * Data export / import — the Settings › Data screen (admin only).
 *
 *   useDataTables()            GET  /api/v1/admin/data/tables
 *   dataExportHref(tables)     the BFF URL for GET /admin/data/export — a
 *                              plain link, so the browser saves the file
 *   useDataImport()            POST /api/v1/admin/data/import
 *   useDataReset()             POST /api/v1/admin/data/reset
 *
 * The import mutation is used twice per run: a dry run (the default) that
 * the server performs and rolls back, then the real run with the typed
 * confirmation phrase. A real run changes data on every screen, so on success
 * it drops the whole query cache rather than guessing which domains moved.
 *
 * `parseExportFile` and `replaceClosure` are pure so the screen's rules are
 * unit-tested without a DOM; the server enforces the same rules regardless.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, BFF_BASE_URL, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type DataTable = components["schemas"]["DataTable"];
export type DataTablesResponse = components["schemas"]["DataTablesResponse"];
export type DataImportRequest = components["schemas"]["DataImportRequest"];
export type DataImportResponse = components["schemas"]["DataImportResponse"];
export type ImportMode = DataImportRequest["mode"];
export type DataResetRequest = components["schemas"]["DataResetRequest"];
export type DataResetResponse = components["schemas"]["DataResetResponse"];
export type ResetScope = "tables" | "all";

/** Phrases the reset dialog asks for; the server checks the same text. */
export const RESET_PHRASE: Record<ResetScope, string> = {
  tables: "RESET",
  all: "WIPE DATABASE",
};

export const EXPORT_FORMAT = "rhemapod-export";
export const CONFIRM_PHRASE: Record<ImportMode, string> = {
  merge: "IMPORT",
  replace: "REPLACE",
};
/** Same ceiling as the BFF and FastAPI (`max_import_bytes`). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export function useDataTables() {
  return useQuery({
    queryKey: queryKeys.settings.dataTables(),
    queryFn: () => unwrap(api.GET("/api/v1/admin/data/tables")),
    staleTime: 30_000,
  });
}

/** Export link for some tables, or the whole database when `tables` is
    empty. */
export function dataExportHref(tables: readonly string[]): string {
  const q = new URLSearchParams();
  for (const name of tables) q.append("tables", name);
  const query = q.toString();
  return `${BFF_BASE_URL}/admin/data/export${query ? `?${query}` : ""}`;
}

export interface ParsedExport {
  document: Record<string, unknown>;
  exportedAt: string | null;
  schemaRevision: string | null;
  /** Table name → row count, in file order. */
  tables: { name: string; rows: number }[];
}

/** Read an export file's text. Throws an `Error` with a readable message
    when it isn't one; the server re-validates everything. */
export function parseExportFile(text: string): ParsedExport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t valid JSON.");
  }
  if (
    !doc ||
    typeof doc !== "object" ||
    (doc as { format?: unknown }).format !== EXPORT_FORMAT
  ) {
    throw new Error("That isn’t a RhemaPod export file.");
  }
  const record = doc as Record<string, unknown>;
  const raw = record.tables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The file contains no tables.");
  }
  const tables = Object.entries(raw as Record<string, unknown>).map(
    ([name, body]) => {
      const rows = (body as { rows?: unknown } | null)?.rows;
      return { name, rows: Array.isArray(rows) ? rows.length : 0 };
    },
  );
  if (tables.length === 0) throw new Error("The file contains no tables.");
  return {
    document: record,
    exportedAt: typeof record.exported_at === "string" ? record.exported_at : null,
    schemaRevision:
      typeof record.schema_revision === "string" ? record.schema_revision : null,
    tables,
  };
}

/** `selected` plus every table that (transitively) points at one of them —
    what a replace of `selected` would also touch. Mirrors
    `data_transfer_service.replace_closure`. */
export function replaceClosure(
  selected: Iterable<string>,
  tables: readonly Pick<DataTable, "name" | "referenced_by">[],
): Set<string> {
  const refs = new Map(tables.map((t) => [t.name, t.referenced_by]));
  const closed = new Set(selected);
  const pending = [...closed];
  while (pending.length > 0) {
    for (const child of refs.get(pending.pop()!) ?? []) {
      if (!closed.has(child)) {
        closed.add(child);
        pending.push(child);
      }
    }
  }
  return closed;
}

export function useDataImport() {
  const qc = useQueryClient();
  return useMutation<DataImportResponse, Error, DataImportRequest>({
    mutationFn: (body) =>
      unwrap(api.POST("/api/v1/admin/data/import", { body })),
    onSuccess: (result) => {
      if (!result.dry_run) void qc.invalidateQueries();
    },
  });
}


/** Tables a reset of `selected` empties too (CASCADE/RESTRICT references,
    from the server's `reset_with`), excluding the selection itself. */
export function resetAlsoEmpties(
  selected: Iterable<string>,
  tables: readonly Pick<DataTable, "name" | "reset_with">[],
): string[] {
  const chosen = new Set(selected);
  const byName = new Map(tables.map((t) => [t.name, t.reset_with]));
  const extra = new Set<string>();
  for (const name of chosen) {
    for (const child of byName.get(name) ?? []) {
      if (!chosen.has(child)) extra.add(child);
    }
  }
  return tables.map((t) => t.name).filter((name) => extra.has(name));
}

export function useDataReset() {
  const qc = useQueryClient();
  return useMutation<DataResetResponse, Error, DataResetRequest>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/admin/data/reset", { body })),
    onSuccess: (result) => {
      // A real reset changes data on every screen.
      if (!result.dry_run) void qc.invalidateQueries();
    },
  });
}
