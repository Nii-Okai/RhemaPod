import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DataTable,
  type DataTableColumn,
} from "@/components/portal/data-table";

/* Render coverage for the DataTable interaction + a11y surface — the part that
   had no unit test before happy-dom (plan Amendment A4). The pure helpers and
   the selection reducer are covered in the node project. */

type Row = { id: string; title: string; speaker: string };

const ROWS: Row[] = [
  { id: "r1", title: "Row One", speaker: "Ada" },
  { id: "r2", title: "Row Two", speaker: "Ben" },
  { id: "r3", title: "Row Three", speaker: "Cal" },
  { id: "r4", title: "Row Four", speaker: "Dan" },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    key: "title",
    header: "Title",
    gridWidth: "2fr",
    cell: (r) => <span>{r.title}</span>,
  },
  {
    key: "speaker",
    header: "Speaker",
    gridWidth: "1fr",
    cell: (r) => <span>{r.speaker}</span>,
  },
];

const base = {
  caption: "Sermons",
  columns: COLUMNS,
  rowKey: (r: Row) => r.id,
};

const rowOf = (text: string): HTMLElement => {
  const el = screen.getByText(text).closest('[role="row"]');
  if (!el) throw new Error(`no row for ${text}`);
  return el as HTMLElement;
};

const selectAllBox = () => screen.getByLabelText("Select all rows");

describe("DataTable — select-all focus hand-off (gilfoyle W6 must-fix)", () => {
  it("hands focus to the bulk-bar select-all when the columns header unmounts", async () => {
    const user = userEvent.setup();
    render(<DataTable {...base} rows={ROWS} selectable />);

    const columnsSelectAll = selectAllBox();
    columnsSelectAll.focus();
    expect(columnsSelectAll).toHaveFocus();

    // Activating select-all takes selection 0 -> all, which swaps the columns
    // header out for the bulk bar and unmounts this checkbox.
    await user.click(columnsSelectAll);

    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();
    expect(selectAllBox()).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("hands focus back to the columns select-all when the bulk bar unmounts (clear path)", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        defaultSelectedKeys={new Set(ROWS.map((r) => r.id))}
      />,
    );

    // Starts in bulk mode (everything selected).
    const bulkSelectAll = selectAllBox();
    bulkSelectAll.focus();
    expect(bulkSelectAll).toHaveFocus();

    await user.click(bulkSelectAll); // all -> 0, bulk bar unmounts

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(selectAllBox()).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("does NOT yank focus off a row when a row toggle crosses the 0 boundary", () => {
    render(<DataTable {...base} rows={ROWS} selectable />);

    const row = rowOf("Row Two");
    row.focus();
    fireEvent.keyDown(row, { key: " " }); // selects Row Two -> enters bulk mode

    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    // The row stayed mounted; focus should still be on it, not the toolbar.
    expect(rowOf("Row Two")).toHaveFocus();
  });
});

describe("DataTable — roving active row tracked by identity (gilfoyle W6)", () => {
  it("keeps focus on the same row when a row ABOVE it is removed", () => {
    const { rerender } = render(
      <DataTable {...base} rows={ROWS} selectable />,
    );

    rowOf("Row Three").focus();
    expect(rowOf("Row Three")).toHaveFocus();

    rerender(
      <DataTable {...base} rows={[ROWS[0], ROWS[2], ROWS[3]]} selectable />,
    );

    expect(
      screen.getByText("Row Three").closest('[role="row"]'),
    ).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("moves focus to a surviving row when the FOCUSED row is removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DataTable {...base} rows={ROWS} onRowClick={() => {}} />,
    );

    await user.click(rowOf("Row Three")); // establishes the active row
    expect(rowOf("Row Three")).toHaveFocus();

    rerender(
      <DataTable
        {...base}
        rows={[ROWS[0], ROWS[1], ROWS[3]]}
        onRowClick={() => {}}
      />,
    );

    expect(document.body).not.toHaveFocus();
    const active = document.activeElement as HTMLElement | null;
    expect(active?.closest('[role="grid"]')).not.toBeNull();
  });
});

describe("DataTable — selection announcement (gilfoyle W6)", () => {
  it("keeps a polite status region in sync with the selection count across the swap", () => {
    render(<DataTable {...base} rows={ROWS} selectable />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");

    fireEvent.click(within(rowOf("Row Two")).getByLabelText("Select row"));
    expect(screen.getByRole("status")).toHaveTextContent("1 selected");

    fireEvent.click(selectAllBox()); // -> all
    expect(screen.getByRole("status")).toHaveTextContent("4 selected");
  });
});

describe("DataTable — row click vs cell click", () => {
  it("fires onRowClick on a plain row click, not on checkbox or rowActions clicks", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        onRowClick={onRowClick}
        rowActions={(r) => (
          <button type="button" aria-label={`menu ${r.id}`}>
            &hellip;
          </button>
        )}
      />,
    );

    await user.click(screen.getByText("Row Two"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);

    await user.click(within(rowOf("Row Three")).getByLabelText("Select row"));
    expect(onRowClick).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("menu r1"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("shift+click routes to range-select and suppresses onRowClick", () => {
    const onRowClick = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        onRowClick={onRowClick}
        onSelectionChange={onSelectionChange}
      />,
    );

    // anchor on Row One
    fireEvent.click(within(rowOf("Row One")).getByLabelText("Select row"));
    onRowClick.mockClear();

    fireEvent.click(screen.getByText("Row Three"), { shiftKey: true });

    const last = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect([...last].sort()).toEqual(["r1", "r2", "r3"]);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("DataTable — keyboard on a focused row", () => {
  it("Space toggles, Shift+Space range-selects, Enter fires onRowClick", () => {
    const onRowClick = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        onRowClick={onRowClick}
        onSelectionChange={onSelectionChange}
      />,
    );

    const r1 = rowOf("Row One");
    r1.focus();
    fireEvent.keyDown(r1, { key: " " });
    expect([
      ...(onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>),
    ]).toEqual(["r1"]);

    const r3 = rowOf("Row Three");
    r3.focus();
    fireEvent.keyDown(r3, { key: " ", shiftKey: true });
    expect(
      [...(onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>)].sort(),
    ).toEqual(["r1", "r2", "r3"]);

    onRowClick.mockClear();
    fireEvent.keyDown(r3, { key: "Enter" });
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[2]);
  });

  it("Arrow / Home / End move the roving tab stop", () => {
    render(<DataTable {...base} rows={ROWS} selectable />);

    const r1 = rowOf("Row One");
    r1.focus();
    fireEvent.keyDown(r1, { key: "ArrowDown" });
    expect(rowOf("Row Two")).toHaveFocus();

    fireEvent.keyDown(rowOf("Row Two"), { key: "End" });
    expect(rowOf("Row Four")).toHaveFocus();

    fireEvent.keyDown(rowOf("Row Four"), { key: "Home" });
    expect(rowOf("Row One")).toHaveFocus();
  });
});

describe("DataTable — loading / skeleton / empty / footer", () => {
  it("sets aria-busy on the grid only while loading", () => {
    const { rerender } = render(
      <DataTable {...base} rows={ROWS} selectable loading />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute("aria-busy", "true");

    rerender(<DataTable {...base} rows={ROWS} selectable loading={false} />);
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
  });

  it("renders skeletonRows × columns.length skeleton cells", () => {
    const { container } = render(
      <DataTable {...base} rows={[]} loading skeletonRows={5} />,
    );
    const skeleton = container.querySelector(
      '[data-slot="data-table-skeleton"]',
    );
    expect(skeleton).not.toBeNull();

    const skeletonRows = Array.from(skeleton!.children);
    expect(skeletonRows).toHaveLength(5);

    const cellCount = skeletonRows.reduce(
      (n, r) => n + r.children.length,
      0,
    );
    expect(cellCount).toBe(5 * COLUMNS.length);
  });

  it("gives the empty-state cell an aria-colspan of the full column count", () => {
    render(
      <DataTable
        {...base}
        rows={[]}
        selectable
        empty={<div>Nothing here yet</div>}
      />,
    );
    const cell = screen
      .getByText("Nothing here yet")
      .closest('[role="gridcell"]');
    // 2 columns + the checkbox track
    expect(cell).toHaveAttribute("aria-colspan", "3");
  });

  it("renders rangeLabel and <Pagination> into the footer when their props are present", () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        {...base}
        rows={ROWS}
        rangeLabel="1–4 of 128"
        page={1}
        pageCount={5}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByText("1–4 of 128")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("keeps the footer for a rangeLabel alone but omits Pagination", () => {
    render(<DataTable {...base} rows={ROWS} rangeLabel="1–4 of 128" />);
    expect(screen.getByText("1–4 of 128")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("DataTable — header ⇄ bulk-bar swap", () => {
  it("mounts exactly one of the column header and the bulk bar", () => {
    render(<DataTable {...base} rows={ROWS} selectable />);

    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);

    fireEvent.click(within(rowOf("Row One")).getByLabelText("Select row"));

    expect(
      screen.getByRole("toolbar", { name: "Bulk actions" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
  });
});

describe("DataTable — non-interactive downgrade (gilfoyle W6 nit)", () => {
  it("uses role=table when there is no selection and no row click", () => {
    render(<DataTable {...base} rows={ROWS} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

describe("DataTable — select-all gesture flag cannot stick (fix-pass 2 #1)", () => {
  it("a no-op controlled toggle does not arm a focus move on a later mode change", async () => {
    const onSelectionChange = vi.fn(); // fully controlled, silently ignores it
    const { rerender } = render(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        selectedKeys={new Set<string>()}
        onSelectionChange={onSelectionChange}
      />,
    );

    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(outside).toHaveFocus();

    // Pointer-toggle select-all. The controlled parent drops the change, so
    // there is NO re-render to clear the in-flight gesture flag — only the
    // disarm microtask does. `fireEvent.click` does not move DOM focus.
    fireEvent.click(selectAllBox());
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(outside).toHaveFocus();

    // Model a later, separate tick: the disarm microtask runs here.
    await act(async () => {});

    // An unrelated prop update now flips columns -> bulk. Pre-fix the stale
    // flag makes the [mode, selectable] layout effect grab the bulk select-all.
    rerender(
      <DataTable
        {...base}
        rows={ROWS}
        selectable
        selectedKeys={new Set(ROWS.map((r) => r.id))}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(
      screen.getByRole("toolbar", { name: "Bulk actions" }),
    ).toBeInTheDocument();
    expect(outside).toHaveFocus();
    expect(selectAllBox()).not.toHaveFocus();

    outside.remove();
  });
});

describe("DataTable — background click then rows refresh (fix-pass 2 #2)", () => {
  it("does NOT pull focus back into the grid after a click into dead page background", async () => {
    const { rerender } = render(
      <DataTable {...base} rows={ROWS} selectable />,
    );

    const row = rowOf("Row Two");
    act(() => {
      row.focus();
    });
    expect(row).toHaveFocus();

    // Click into non-focusable page background: DOM focus falls to <body> and
    // the focusout carries a null relatedTarget — the exact signature of a row
    // removal, which is why onBlur alone can't tell them apart.
    act(() => {
      row.blur();
    });
    await act(async () => {}); // flush the onBlur snapshot-refresh microtask
    expect(document.body).toHaveFocus();

    // A poll/refresh now drops the row the user already left.
    rerender(
      <DataTable {...base} rows={[ROWS[0], ROWS[2], ROWS[3]]} selectable />,
    );

    expect(document.body).toHaveFocus();
    expect(
      (document.activeElement as HTMLElement | null)?.closest('[role="grid"]'),
    ).toBeNull();
  });

  it("STILL restores focus to a surviving row when the focused row itself is removed (regression)", () => {
    const { rerender } = render(
      <DataTable {...base} rows={ROWS} selectable />,
    );

    const row = rowOf("Row Two");
    act(() => {
      row.focus();
    });
    expect(row).toHaveFocus();

    // No background click — the row is removed while it still holds focus.
    rerender(
      <DataTable {...base} rows={[ROWS[0], ROWS[2], ROWS[3]]} selectable />,
    );

    const active = document.activeElement as HTMLElement | null;
    expect(document.body).not.toHaveFocus();
    expect(active?.getAttribute("role")).toBe("row");
    expect(active?.closest('[role="grid"]')).not.toBeNull();
  });
});
