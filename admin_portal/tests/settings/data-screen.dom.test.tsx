import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { DataScreen } from "@/components/settings/data-screen";

/* Settings › Data, rendered (happy-dom), every backend call MSW. The import
   flow is: choose file → Preview (a dry run) → Import… → type the phrase. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TABLES = {
  schema_revision: "rev1",
  tables: [
    { name: "users", rows: 3, importable: true, replaceable: false, referenced_by: ["sermons"] },
    { name: "categories", rows: 2, importable: true, replaceable: true, referenced_by: ["sermons"] },
    { name: "sermons", rows: 5, importable: true, replaceable: true, referenced_by: [] },
    { name: "audit_log", rows: 9, importable: false, replaceable: false, referenced_by: [] },
  ],
};

const FILE = {
  format: "rhemapod-export",
  version: 1,
  exported_at: "2026-10-22T10:00:00+00:00",
  schema_revision: "rev1",
  tables: {
    categories: { columns: ["id", "name"], rows: [["c1", "Faith"]] },
    audit_log: { columns: ["id"], rows: [] },
  },
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataScreen />
    </QueryClientProvider>,
  );
}

function fileOf(doc: unknown) {
  return new File([JSON.stringify(doc)], "backup.json", { type: "application/json" });
}

describe("DataScreen", () => {
  it("offers whole-database and per-table export links", async () => {
    server.use(http.get("*/api/bff/admin/data/tables", () => HttpResponse.json(TABLES)));
    renderScreen();
    const all = await screen.findByRole("link", { name: "Export entire database" });
    expect(all.getAttribute("href")).toBe("/api/bff/admin/data/export");

    const exportCard = all.closest("[data-slot='data-export']") as HTMLElement;
    await userEvent.click(within(exportCard).getByLabelText(/^users/));
    expect(
      within(exportCard).getByRole("link", { name: "Export 1 selected table" }).getAttribute("href"),
    ).toBe("/api/bff/admin/data/export?tables=users");
  });

  it("previews, then imports only after the phrase is typed", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.get("*/api/bff/admin/data/tables", () => HttpResponse.json(TABLES)),
      http.post("*/api/bff/admin/data/import", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({
          mode: body.mode,
          dry_run: body.dry_run,
          tables: [{ name: "categories", inserted: 0, updated: 1, deleted: 0, skipped: 0 }],
        });
      }),
    );
    renderScreen();
    const input = (await screen.findByText("Choose export file"))
      .closest("div")!
      .querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, fileOf(FILE));

    // audit_log is in the file but export-only, so it's not selectable.
    expect(await screen.findByText("export only")).toBeTruthy();
    const importButton = screen.getByRole("button", { name: "Import…" });
    expect(importButton).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByText(/Preview — what the import will do/);
    expect(bodies[0]).toMatchObject({ dry_run: true, mode: "merge", tables: ["categories"] });

    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Import" });
    expect(go).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), "IMPORT");
    await userEvent.click(go);

    await screen.findByText("Import complete");
    expect(bodies[1]).toMatchObject({ dry_run: false, confirm: "IMPORT" });
  });

  it("refuses a file from a different schema version before sending it", async () => {
    server.use(http.get("*/api/bff/admin/data/tables", () => HttpResponse.json(TABLES)));
    renderScreen();
    const input = (await screen.findByText("Choose export file"))
      .closest("div")!
      .querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, fileOf({ ...FILE, schema_revision: "old" }));
    expect(await screen.findByText("Different database version")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled(),
    );
  });
});
