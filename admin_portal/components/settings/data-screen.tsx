"use client";

import * as React from "react";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { isApiError } from "@/lib/api/errors";
import {
  CONFIRM_PHRASE,
  dataExportHref,
  MAX_IMPORT_BYTES,
  parseExportFile,
  replaceClosure,
  useDataImport,
  useDataTables,
  type DataImportResponse,
  type DataTable,
  type ImportMode,
  type ParsedExport,
} from "@/lib/query/hooks/use-data-transfer";

/* =============================================================================
   DataScreen — Settings › Data (admin only).

   Export: pick tables (or everything) and download one JSON file. Password
   hashes are never in it; the audit trail is export-only.

   Import, in three deliberate steps so nothing destructive happens by
   accident:
     1. Choose an export file — it's read in the browser first, so a wrong
        file is caught before anything is sent.
     2. Pick tables and a mode, then "Preview changes": the server runs the
        whole import inside a transaction and rolls it back, returning the
        counts a real run would produce.
     3. "Import…" opens a dialog that names what will happen and needs the
        mode's phrase typed in. Replace mode pulls in every table that points
        at a selected one (the server refuses otherwise) and says so.

   The server enforces every rule here; this screen only explains them.
   ========================================================================== */

const n = (value: number) => value.toLocaleString("en-US");

function errorText(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId ? `${err.detail} (reference: ${err.correlationId})` : err.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* --- shared table checklist ---------------------------------------------- */

interface ChecklistRow {
  name: string;
  rows: number;
  disabled?: boolean;
  note?: string;
}

function TableChecklist({
  label,
  rows,
  selected,
  onToggle,
  onSetAll,
}: {
  label: string;
  rows: ChecklistRow[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSetAll: (names: string[]) => void;
}) {
  const enabled = rows.filter((r) => !r.disabled).map((r) => r.name);
  const allOn = enabled.length > 0 && enabled.every((name) => selected.has(name));
  return (
    <fieldset className="flex flex-col gap-8">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center justify-between gap-12">
        <span className="text-mono-eyebrow text-ink-faint">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSetAll(allOn ? [] : enabled)}
        >
          {allOn ? "Clear all" : "Select all"}
        </Button>
      </div>
      <ul className="grid grid-cols-1 gap-x-16 gap-y-4 sm:grid-cols-2 min-[1100px]:grid-cols-3">
        {rows.map((row) => {
          const id = `table-${label}-${row.name}`;
          return (
            <li key={row.name} className="flex min-w-0 items-center gap-8 py-2">
              <Checkbox
                id={id}
                checked={selected.has(row.name)}
                disabled={row.disabled}
                onChange={() => onToggle(row.name)}
              />
              <label
                htmlFor={id}
                className={cn(
                  "flex min-w-0 flex-1 items-baseline justify-between gap-8 text-[13.5px]",
                  row.disabled ? "text-ink-disabled" : "text-ink",
                )}
                title={row.note}
              >
                <span className="truncate font-mono text-[12.5px]">{row.name}</span>
                <span className="shrink-0 text-[12px] text-ink-faint">
                  {row.note ?? `${n(row.rows)} rows`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function toggle(set: Set<string>, name: string): Set<string> {
  const next = new Set(set);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}

/* --- export --------------------------------------------------------------- */

function ExportCard({ tables }: { tables: DataTable[] }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const ordered = tables.filter((t) => selected.has(t.name)).map((t) => t.name);
  const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);

  return (
    <Card className="flex flex-col gap-16" data-slot="data-export">
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <span className="text-[12.5px] text-ink-faint">
          {tables.length} tables · {n(totalRows)} rows
        </span>
      </CardHeader>
      <p className="text-[13.5px] text-ink-muted">
        Downloads a JSON file you can keep as a backup or import later. It
        contains members’ personal details (names, emails), so store it
        somewhere safe. Passwords are never included — people restored from a
        file sign in with a password reset.
      </p>
      <TableChecklist
        label="Tables"
        rows={tables.map((t) => ({ name: t.name, rows: t.rows }))}
        selected={selected}
        onToggle={(name) => setSelected((s) => toggle(s, name))}
        onSetAll={(names) => setSelected(new Set(names))}
      />
      <div className="flex flex-wrap items-center gap-8">
        <a
          className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
          href={dataExportHref([])}
          download
        >
          Export entire database
        </a>
        {ordered.length > 0 ? (
          <a
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            href={dataExportHref(ordered)}
            download
          >
            Export {ordered.length} selected {ordered.length === 1 ? "table" : "tables"}
          </a>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            Export selected tables
          </Button>
        )}
      </div>
    </Card>
  );
}

/* --- import --------------------------------------------------------------- */

function ResultTable({ result }: { result: DataImportResponse }) {
  const replace = result.mode === "replace";
  return (
    <div className="overflow-x-auto rounded-12 border border-border">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-surface-sunken text-ink-muted">
          <tr>
            <th className="px-12 py-8 font-medium">Table</th>
            {replace ? <th className="px-12 py-8 text-right font-medium">Deleted</th> : null}
            <th className="px-12 py-8 text-right font-medium">Added</th>
            {replace ? null : <th className="px-12 py-8 text-right font-medium">Updated</th>}
            <th className="px-12 py-8 text-right font-medium">Skipped</th>
          </tr>
        </thead>
        <tbody>
          {result.tables.map((row) => (
            <tr key={row.name} className="border-t border-border">
              <td className="px-12 py-6 font-mono text-[12.5px]">{row.name}</td>
              {replace ? <td className="px-12 py-6 text-right">{n(row.deleted)}</td> : null}
              <td className="px-12 py-6 text-right">{n(row.inserted)}</td>
              {replace ? null : <td className="px-12 py-6 text-right">{n(row.updated)}</td>}
              <td className="px-12 py-6 text-right">{n(row.skipped)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportCard({
  tables,
  schemaRevision,
}: {
  tables: DataTable[];
  schemaRevision: string | null;
}) {
  const fileInputId = React.useId();
  const [file, setFile] = React.useState<{ name: string; parsed: ParsedExport } | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ImportMode>("merge");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<DataImportResponse | null>(null);
  const [done, setDone] = React.useState<DataImportResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const importer = useDataImport();

  const known = React.useMemo(() => new Map(tables.map((t) => [t.name, t])), [tables]);

  // Anything that changes what would be imported invalidates the preview.
  const resetRun = () => {
    setPreview(null);
    setDone(null);
    importer.reset();
  };

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    resetRun();
    setFile(null);
    setFileError(null);
    if (!picked) return;
    if (picked.size > MAX_IMPORT_BYTES) {
      setFileError("That file is over 25 MB. Export fewer tables at a time.");
      return;
    }
    try {
      const parsed = parseExportFile(await picked.text());
      setFile({ name: picked.name, parsed });
      setSelected(
        new Set(parsed.tables.map((t) => t.name).filter((name) => known.get(name)?.importable)),
      );
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Couldn’t read that file.");
    }
  }

  const fileRows: ChecklistRow[] = (file?.parsed.tables ?? []).map((t) => {
    const info = known.get(t.name);
    let note: string | undefined;
    if (!info) note = "not in this database";
    else if (!info.importable) note = "export only";
    else if (mode === "replace" && !info.replaceable) note = "merge only";
    return {
      name: t.name,
      rows: t.rows,
      disabled: note !== undefined,
      note: note ?? `${n(t.rows)} rows`,
    };
  });
  const allowed = new Set(fileRows.filter((r) => !r.disabled).map((r) => r.name));
  const chosen = [...selected].filter((name) => allowed.has(name));

  // Replace pulls in every table that points at a chosen one.
  const effective =
    mode === "replace" ? [...replaceClosure(chosen, tables)] : chosen;
  const pulledIn = effective.filter((name) => !chosen.includes(name));
  const inFile = new Set(file?.parsed.tables.map((t) => t.name) ?? []);
  const pulledMissing = pulledIn.filter((name) => !inFile.has(name));

  const revisionMismatch =
    file !== null && file.parsed.schemaRevision !== schemaRevision;

  const canRun =
    file !== null && effective.length > 0 && pulledMissing.length === 0 && !revisionMismatch;

  const body = (dryRun: boolean, confirm?: string) => ({
    document: file!.parsed.document,
    mode,
    tables: effective,
    dry_run: dryRun,
    confirm: confirm ?? null,
  });

  const runPreview = () => {
    if (!canRun) return;
    setDone(null);
    importer.mutate(body(true), { onSuccess: setPreview });
  };

  return (
    <Card className="flex flex-col gap-16" data-slot="data-import">
      <CardHeader>
        <CardTitle>Import</CardTitle>
        <span className="text-[12.5px] text-ink-faint">Admins only · every run is audited</span>
      </CardHeader>
      <p className="text-[13.5px] text-ink-muted">
        Restore from an export file made by this portal. Nothing changes until
        you preview the import and then confirm it. Take a fresh export first
        so you can undo.
      </p>

      <div className="flex flex-wrap items-center gap-10">
        <label
          htmlFor={fileInputId}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}
        >
          {file ? "Choose a different file" : "Choose export file"}
        </label>
        <input
          id={fileInputId}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={onFile}
        />
        {file ? (
          <span className="text-[13px] text-ink-muted">
            <span className="font-medium text-ink">{file.name}</span> · exported{" "}
            {formatWhen(file.parsed.exportedAt)} · {file.parsed.tables.length} tables
          </span>
        ) : null}
      </div>

      {fileError ? (
        <Alert variant="error" title="Can’t use that file">
          {fileError}
        </Alert>
      ) : null}

      {revisionMismatch ? (
        <Alert variant="error" title="Different database version">
          This file was exported from database version{" "}
          <code>{file?.parsed.schemaRevision ?? "unknown"}</code>, but this one is{" "}
          <code>{schemaRevision ?? "unknown"}</code>. Import is only allowed between
          matching versions.
        </Alert>
      ) : null}

      {file ? (
        <>
          <fieldset className="flex flex-col gap-8">
            <legend className="text-mono-eyebrow mb-8 text-ink-faint">Mode</legend>
            {(
              [
                [
                  "merge",
                  "Merge",
                  "Add rows that are new and update rows that already exist (matched by id). Nothing is deleted.",
                ],
                [
                  "replace",
                  "Replace",
                  "Delete every row in the chosen tables, then load the file’s rows. Rows not in the file are gone.",
                ],
              ] as const
            ).map(([value, title, help]) => (
              <label key={value} className="flex items-start gap-10 text-[13.5px]">
                <Radio
                  name="import-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    resetRun();
                  }}
                  className="mt-[2px]"
                />
                <span>
                  <span className="font-semibold text-ink">{title}</span>
                  <span className="block text-ink-muted">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <TableChecklist
            label="Tables in this file"
            rows={fileRows}
            selected={selected}
            onToggle={(name) => {
              setSelected((s) => toggle(s, name));
              resetRun();
            }}
            onSetAll={(names) => {
              setSelected(new Set(names));
              resetRun();
            }}
          />

          {mode === "replace" && pulledIn.length > 0 ? (
            <Alert
              variant={pulledMissing.length > 0 ? "error" : "warning"}
              title={
                pulledMissing.length > 0
                  ? "Replace needs tables this file doesn’t have"
                  : "Replace also includes dependent tables"
              }
            >
              {pulledMissing.length > 0
                ? `Replacing these tables would also clear ${pulledMissing.join(", ")}, which aren’t in the file. Use merge, or import a full export.`
                : `Rows in ${pulledIn.join(", ")} point at the tables you picked, so they are replaced too.`}
            </Alert>
          ) : null}

          {importer.isError ? (
            <Alert variant="error" title="Import refused — nothing was changed">
              {errorText(importer.error, "Please try again.")}
            </Alert>
          ) : null}

          {done ? (
            <Alert variant="success" title="Import complete">
              The data has been imported and the audit trail updated. Other
              screens show the new data.
            </Alert>
          ) : null}

          {preview && !done ? (
            <div className="flex flex-col gap-8">
              <span className="text-mono-eyebrow text-ink-faint">
                Preview — what the import will do
              </span>
              <ResultTable result={preview} />
            </div>
          ) : null}
          {done ? <ResultTable result={done} /> : null}

          <div className="flex flex-wrap items-center gap-8">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canRun || importer.isPending}
              onClick={runPreview}
            >
              {importer.isPending && !confirmOpen ? "Checking…" : "Preview changes"}
            </Button>
            <Button
              variant={mode === "replace" ? "destructive" : "primary"}
              size="sm"
              disabled={!canRun || !preview || importer.isPending || done !== null}
              onClick={() => setConfirmOpen(true)}
              title={preview ? undefined : "Preview the changes first."}
            >
              {mode === "replace" ? "Replace data…" : "Import…"}
            </Button>
          </div>

          <ConfirmImportDialog
            open={confirmOpen}
            mode={mode}
            tables={effective}
            pending={importer.isPending}
            error={importer.isError && confirmOpen ? errorText(importer.error, "") : null}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={(phrase) =>
              importer.mutate(body(false, phrase), {
                onSuccess: (result) => {
                  setDone(result);
                  setConfirmOpen(false);
                },
              })
            }
          />
        </>
      ) : null}
    </Card>
  );
}

function ConfirmImportDialog({
  open,
  mode,
  tables,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  mode: ImportMode;
  tables: string[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (phrase: string) => void;
}) {
  const [typed, setTyped] = React.useState("");
  const phrase = CONFIRM_PHRASE[mode];
  const inputId = React.useId();
  const matches = typed.trim() === phrase;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setTyped("");
          onCancel();
        }
      }}
    >
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogTitle>
          {mode === "replace" ? "Replace data in" : "Import into"} {tables.length}{" "}
          {tables.length === 1 ? "table" : "tables"}?
        </DialogTitle>
        <DialogDescription>
          {mode === "replace"
            ? "Every existing row in these tables is deleted and replaced with the file’s rows. This can’t be undone except by importing a backup."
            : "Rows in the file are added, and existing rows with the same id are overwritten. This can’t be undone except by importing a backup."}
        </DialogDescription>
        <p className="break-words font-mono text-[12.5px] text-ink-muted">
          {tables.join(", ")}
        </p>
        <form
          className="flex flex-col gap-12"
          onSubmit={(event) => {
            event.preventDefault();
            if (matches && !pending) onConfirm(phrase);
          }}
        >
          <label htmlFor={inputId} className="text-[13.5px] text-ink">
            Type <span className="font-mono font-semibold">{phrase}</span> to confirm
          </label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
          {error ? (
            <Alert variant="error" title="Import refused — nothing was changed">
              {error}
            </Alert>
          ) : null}
          <div className="flex justify-end gap-8">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTyped("");
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === "replace" ? "destructive" : "primary"}
              size="sm"
              disabled={!matches || pending}
            >
              {pending ? "Importing…" : mode === "replace" ? "Replace data" : "Import"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --- screen --------------------------------------------------------------- */

export function DataScreen() {
  const tables = useDataTables();

  if (tables.isPending) {
    return <p className="text-[13.5px] text-ink-muted">Loading tables…</p>;
  }
  if (tables.isError) {
    return (
      <Alert variant="error" title="Couldn’t load the table list">
        {errorText(tables.error, "Please try again.")}
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-20">
      <ExportCard tables={tables.data.tables} />
      <ImportCard tables={tables.data.tables} schemaRevision={tables.data.schema_revision} />
    </div>
  );
}
