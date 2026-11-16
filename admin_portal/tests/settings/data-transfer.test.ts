import { describe, expect, it } from "vitest";

import {
  dataExportHref,
  parseExportFile,
  replaceClosure,
} from "@/lib/query/hooks/use-data-transfer";

/* Settings › Data — the pure rules the screen leans on. The server enforces
   the same ones; these keep the screen's explanation honest. */

describe("dataExportHref", () => {
  it("exports everything with no tables, and repeats `tables` otherwise", () => {
    expect(dataExportHref([])).toBe("/api/bff/admin/data/export");
    expect(dataExportHref(["users", "sermons"])).toBe(
      "/api/bff/admin/data/export?tables=users&tables=sermons",
    );
  });
});

describe("parseExportFile", () => {
  it("reads the envelope and per-table row counts", () => {
    const parsed = parseExportFile(
      JSON.stringify({
        format: "rhemapod-export",
        version: 1,
        exported_at: "2026-10-22T10:00:00+00:00",
        schema_revision: "abc",
        tables: { categories: { columns: ["id"], rows: [["1"], ["2"]] } },
      }),
    );
    expect(parsed.schemaRevision).toBe("abc");
    expect(parsed.tables).toEqual([{ name: "categories", rows: 2 }]);
  });

  it("refuses non-JSON, other formats and empty files", () => {
    expect(() => parseExportFile("{")).toThrow(/valid JSON/);
    expect(() => parseExportFile(JSON.stringify({ format: "x" }))).toThrow(/RhemaPod/);
    expect(() =>
      parseExportFile(JSON.stringify({ format: "rhemapod-export", tables: {} })),
    ).toThrow(/no tables/);
  });
});

describe("replaceClosure", () => {
  const tables = [
    { name: "categories", referenced_by: ["sermons", "series"] },
    { name: "series", referenced_by: ["sermons"] },
    { name: "sermons", referenced_by: ["media_refs"] },
    { name: "media_refs", referenced_by: [] },
    { name: "speakers", referenced_by: ["sermons"] },
  ];

  it("pulls in every table that points at a chosen one, transitively", () => {
    expect([...replaceClosure(["categories"], tables)].sort()).toEqual([
      "categories",
      "media_refs",
      "series",
      "sermons",
    ]);
  });

  it("leaves a leaf table alone", () => {
    expect([...replaceClosure(["media_refs"], tables)]).toEqual(["media_refs"]);
  });
});
