"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/portal";
import { EditorField } from "@/components/sermons/editor/field";
import { useSession } from "@/lib/auth/session-context";
import { isApiError } from "@/lib/api/errors";
import { dayLabel } from "@/lib/devotionals/calendar";
import {
  IMPORT_TEMPLATE_URL,
  runImport,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
} from "@/lib/query/hooks/use-devotionals";
import { queryKeys } from "@/lib/query/keys";
import { useQueryClient } from "@tanstack/react-query";

/* =============================================================================
   Bulk import (plan-daily-devotional A4).

   1. Choose a CSV (one row per day, each with its own passage).
   2. Check: a dry run shows every row as ready / warning / error / clash.
   3. Import: the same file again, for real, with the chosen clash rule.

   Nothing is written until step 3, and step 3 sends exactly the file that was
   checked. Rows with errors are skipped; the result says how many.
   ========================================================================== */

const MAX_BYTES = 2 * 1024 * 1024;

const ROW_TONE: Record<ImportRow["status"], string> = {
  ready: "bg-sage-tint text-sage-text",
  warning: "bg-wheat-tint text-wheat-text",
  error: "bg-rose-tint text-rose-text",
  clash: "bg-slate-tint text-slate-text",
};
const ROW_LABEL: Record<ImportRow["status"], string> = {
  ready: "Ready",
  warning: "Warning",
  error: "Error",
  clash: "Date taken",
};

type Filter = "all" | ImportRow["status"];

export function ImportWizard() {
  const { role } = useSession();
  const isManager = role === "manager" || role === "admin";
  const qc = useQueryClient();
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [opts, setOpts] = React.useState<Omit<ImportOptions, "dryRun">>({ as: "draft", onClash: "skip" });
  const [check, setCheck] = React.useState<ImportResult | null>(null);
  const [done, setDone] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");

  async function choose(f: File) {
    setError(null);
    setCheck(null);
    setDone(null);
    if (f.size > MAX_BYTES) {
      setError("That file is over 2 MB. Split it into smaller files.");
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    await dryRun(text, opts);
  }

  async function dryRun(text: string, o: typeof opts) {
    setBusy(true);
    try {
      setCheck(await runImport(text, { ...o, dryRun: true }));
    } catch (err) {
      setError(isApiError(err) ? err.detail : "Couldn’t read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await runImport(file.text, { ...opts, dryRun: false });
      setDone(r);
      void qc.invalidateQueries({ queryKey: queryKeys.devotionals.all() });
    } catch (err) {
      setError(isApiError(err) ? err.detail : "The import didn’t go through. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  function changeOpts(next: typeof opts) {
    setOpts(next);
    if (file) void dryRun(file.text, next);
  }

  const rows = (check?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const importable = check ? check.ready + check.warnings + (opts.onClash === "skip" ? 0 : check.clashes) : 0;

  return (
    <div className="flex flex-col gap-20">
      <PageHeader
        title="Bulk import"
        subhead={
          <>
            <Link href="/devotionals" className="text-clay-600 hover:underline">
              Devotionals
            </Link>{" "}
            · Load a month, a quarter or a year at once from a spreadsheet.
          </>
        }
      />

      {error ? (
        <Alert variant="error" title="Import problem">
          {error}
        </Alert>
      ) : null}

      {done ? (
        <Alert variant="success" title="Import finished">
          {done.created} created, {done.replaced} replaced, {done.pooled} added to the evergreen pool,{" "}
          {done.skipped} skipped.{" "}
          <Link href="/devotionals" className="underline">
            See the calendar
          </Link>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-16 min-[1100px]:grid-cols-[320px_1fr]">
        <Card className="flex flex-col gap-14">
          <CardHeader>
            <CardTitle>1 · Choose a file</CardTitle>
          </CardHeader>
          <p className="text-[13px] text-ink-muted">
            One row per day, each with its own passage. Leave the date blank to add a row to the evergreen
            pool.{" "}
            <a href={IMPORT_TEMPLATE_URL} className="text-clay-600 underline" download="devotionals-template.csv">
              Download the template
            </a>
            .
          </p>
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center gap-6 rounded-12 border border-dashed border-border-strong p-20 text-center hover:bg-clay-50",
              "focus-within:focus-ring-button",
            )}
          >
            <span className="text-[14px] font-medium text-ink">{file ? file.name : "Choose a CSV file"}</span>
            <span className="text-[12px] text-ink-faint">Up to 400 rows, 2 MB</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void choose(f);
                e.target.value = "";
              }}
            />
          </label>

          <CardTitle className="mt-6">2 · Options</CardTitle>
          <EditorField label="Import as" htmlFor="imp-as" hint={isManager ? "Approved rows go live on their dates." : "Editors import drafts; a manager approves them."}>
            <Select
              id="imp-as"
              value={opts.as}
              onChange={(e) => changeOpts({ ...opts, as: e.target.value as ImportOptions["as"] })}
            >
              <option value="draft">Drafts</option>
              {isManager ? <option value="approved">Approved</option> : null}
            </Select>
          </EditorField>
          <EditorField label="When a date already has a devotional" htmlFor="imp-clash">
            <Select
              id="imp-clash"
              value={opts.onClash}
              onChange={(e) => changeOpts({ ...opts, onClash: e.target.value as ImportOptions["onClash"] })}
            >
              <option value="skip">Skip the row</option>
              <option value="replace_draft">Replace it if it is still a draft</option>
              <option value="to_pool">Add the row to the evergreen pool</option>
            </Select>
          </EditorField>

          <Button disabled={!check || busy || importable === 0 || !!done} onClick={() => void commit()}>
            {busy && check ? "Importing…" : `3 · Import ${importable} row${importable === 1 ? "" : "s"}`}
          </Button>
        </Card>

        <Card className="flex min-w-0 flex-col gap-12">
          <CardHeader>
            <CardTitle>Check</CardTitle>
            {check ? (
              <span className="font-mono text-[12px] text-ink-faint">{check.rows.length} rows</span>
            ) : null}
          </CardHeader>
          {!check ? (
            <p className="text-[13.5px] text-ink-muted">
              {busy ? "Checking the file…" : "Choose a file to see each row checked before anything is saved."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-6" role="group" aria-label="Filter rows">
                {(
                  [
                    ["all", `All ${check.rows.length}`],
                    ["ready", `Ready ${check.ready}`],
                    ["warning", `Warnings ${check.warnings}`],
                    ["clash", `Date taken ${check.clashes}`],
                    ["error", `Errors ${check.errors}`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={filter === v}
                    onClick={() => setFilter(v)}
                    className={cn(
                      "h-[28px] rounded-full border px-12 text-[12.5px]",
                      filter === v ? "border-clay-600 bg-clay-50 text-clay-700" : "border-border text-ink-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="text-[11.5px] uppercase text-ink-faint">
                    <tr>
                      <th className="py-6 pr-8 font-mono font-normal">Row</th>
                      <th className="py-6 pr-8 font-normal">Date</th>
                      <th className="py-6 pr-8 font-normal">Title</th>
                      <th className="py-6 pr-8 font-normal">Passage</th>
                      <th className="py-6 pr-8 font-normal">Word</th>
                      <th className="py-6 font-normal">Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {rows.map((r) => (
                      <tr key={r.row} className="align-top">
                        <td className="py-8 pr-8 font-mono text-ink-faint">{r.row}</td>
                        <td className="whitespace-nowrap py-8 pr-8">{r.date ? dayLabel(r.date) : "Evergreen"}</td>
                        <td className="py-8 pr-8 text-ink">{r.title ?? "—"}</td>
                        <td className="whitespace-nowrap py-8 pr-8">{r.passage_ref ?? "—"}</td>
                        <td className="py-8 pr-8">{r.suggested_word ?? ""}</td>
                        <td className="py-8">
                          <span className={cn("inline-flex h-[22px] items-center rounded-full px-8 text-[11.5px] font-semibold", ROW_TONE[r.status])}>
                            {ROW_LABEL[r.status]}
                          </span>
                          {r.messages.map((m, i) => (
                            <span key={i} className="mt-2 block text-[12px] text-ink-muted">
                              {m}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
