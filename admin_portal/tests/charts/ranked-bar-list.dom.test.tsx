import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { RankedBarList, type RankedBarItem } from "@/components/charts/RankedBarList";

/* Plan §W22 — the "Top sermons" ranked list, composed from the Phase 1
   `Progress` primitive. Presentational only. Assertions are on row order, the
   2-digit rank, the formatted value, and the proportional bar (`Progress`
   renders `role="progressbar"` with `aria-valuenow` = value / max * 100). */

const TOP: RankedBarItem[] = [
  { label: "Anchored: Part One", value: 3102 },
  { label: "Bread for the Journey", value: 2284 },
  { label: "Quiet Obedience", value: 1806 },
  { label: "The Narrow Door", value: 1370 },
];

const rows = () => screen.getAllByRole("listitem");
const barValue = (row: HTMLElement) =>
  Number(within(row).getByRole("progressbar").getAttribute("aria-valuenow"));

describe("RankedBarList", () => {
  it("renders rows in the given order with a 2-digit rank", () => {
    render(<RankedBarList items={TOP} />);
    const rendered = rows();
    expect(rendered).toHaveLength(4);
    expect(rendered[0]).toHaveTextContent("01");
    expect(rendered[0]).toHaveTextContent("Anchored: Part One");
    expect(rendered[3]).toHaveTextContent("04");
    expect(rendered[3]).toHaveTextContent("The Narrow Door");
  });

  it("sizes each bar proportionally to the largest value", () => {
    render(<RankedBarList items={TOP} />);
    const rendered = rows();
    expect(barValue(rendered[0])).toBe(100); // the max
    expect(barValue(rendered[1])).toBe(Math.round((2284 / 3102) * 100));
    expect(barValue(rendered[3])).toBe(Math.round((1370 / 3102) * 100));
  });

  it("formats values with thousands grouping by default", () => {
    render(<RankedBarList items={TOP} />);
    expect(screen.getByText("3,102")).toBeInTheDocument();
    expect(screen.getByText("1,370")).toBeInTheDocument();
  });

  it("honours a custom value formatter", () => {
    render(
      <RankedBarList items={TOP} formatValue={(v) => `${v} plays`} />,
    );
    expect(screen.getByText("3102 plays")).toBeInTheDocument();
  });

  it("renders a single item at a full-width bar", () => {
    render(<RankedBarList items={[{ label: "Solo", value: 42 }]} />);
    const rendered = rows();
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveTextContent("01");
    expect(barValue(rendered[0])).toBe(100);
  });

  it("shows an empty state and no bars when there are no items", () => {
    render(<RankedBarList items={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("does not divide by zero for an all-zero series", () => {
    render(
      <RankedBarList
        items={[
          { label: "A", value: 0 },
          { label: "B", value: 0 },
        ]}
      />,
    );
    const rendered = rows();
    expect(rendered).toHaveLength(2);
    rendered.forEach((row) => expect(barValue(row)).toBe(0));
  });
});
