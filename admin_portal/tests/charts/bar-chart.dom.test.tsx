import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BarChart, type BarChartDatum } from "@/components/charts/BarChart";

/* Plan §W22 — the hand-rolled SVG bar chart. Presentational only: no backend,
   no router, so a bare render is enough. Assertions are on structure and the
   `data-height` / `data-value` props each `<path>` carries, never on a
   snapshot (§W22 "No snapshot tests"). */

const WEEK_LABELS = ["W28", "W29", "W30", "W31", "W32", "W33", "W34", "W35"];

const series = (values: number[]): BarChartDatum[] =>
  values.map((value, i) => ({ label: WEEK_LABELS[i], value }));

function bars(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll('[data-slot="bar-chart-bar"]'),
  ) as SVGPathElement[];
}

const heightOf = (el: Element) => Number(el.getAttribute("data-height"));

describe("BarChart", () => {
  it("renders one bar per datum for an 8-week series", () => {
    const { container } = render(
      <BarChart title="New listeners" data={series([10, 20, 30, 40, 50, 60, 70, 80])} />,
    );
    expect(bars(container)).toHaveLength(8);
  });

  it("scales bar heights linearly against the series max", () => {
    const { container } = render(
      <BarChart
        title="New listeners"
        height={200}
        data={series([10, 20, 30, 40, 50, 60, 70, 80])}
      />,
    );
    const rendered = bars(container);

    // Tallest bar (value 80 == max) fills the 200px plot area.
    expect(heightOf(rendered[7])).toBeCloseTo(200, 5);
    // Half the max value -> half the height.
    expect(heightOf(rendered[3])).toBeCloseTo(100, 5);
    // Linear: value 20 is a quarter of the max -> a quarter of the height.
    expect(heightOf(rendered[1]) / heightOf(rendered[7])).toBeCloseTo(0.25, 5);
  });

  it("renders week labels in order", () => {
    const { container } = render(
      <BarChart title="New listeners" data={series([1, 2, 3, 4, 5, 6, 7, 8])} />,
    );
    const labels = Array.from(
      container.querySelectorAll('[data-slot="bar-chart-label"]'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(WEEK_LABELS);
  });

  it("shows an empty state and no bars when the series is empty (n=0)", () => {
    const { container } = render(<BarChart title="New listeners" data={[]} />);
    expect(bars(container)).toHaveLength(0);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("shows the empty state for an all-zero series, not eight invisible bars", () => {
    const { container } = render(
      <BarChart title="New listeners" data={series([0, 0, 0, 0, 0, 0, 0, 0])} />,
    );
    expect(bars(container)).toHaveLength(0);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("renders the single non-zero bucket at full height with the rest on the baseline (n=1)", () => {
    const { container } = render(
      <BarChart
        title="New listeners"
        height={150}
        data={series([0, 0, 0, 5, 0, 0, 0, 0])}
      />,
    );
    const rendered = bars(container);
    expect(rendered).toHaveLength(8);

    const full = rendered.filter((el) => heightOf(el) > 0);
    expect(full).toHaveLength(1);
    expect(heightOf(full[0])).toBeCloseTo(150, 5);
    expect(rendered[3]).toBe(full[0]);

    // Every other bucket is flat on the baseline and paints nothing.
    rendered
      .filter((_, i) => i !== 3)
      .forEach((el) => {
        expect(heightOf(el)).toBe(0);
        expect(el.getAttribute("d")).toBe("");
      });
    // All eight labels still present.
    expect(
      container.querySelectorAll('[data-slot="bar-chart-label"]'),
    ).toHaveLength(8);
  });

  it("exposes an accessible name and an SVG <title>", () => {
    const { container } = render(
      <BarChart title="New listeners, last 8 weeks" data={series([1, 2, 3, 4, 5, 6, 7, 8])} />,
    );
    expect(screen.getByRole("img", { name: "New listeners, last 8 weeks" })).toBeInTheDocument();
    expect(container.querySelector("svg > title")?.textContent).toBe(
      "New listeners, last 8 weeks",
    );
  });

  it("names the empty state with the chart title", () => {
    render(<BarChart title="New listeners" data={[]} emptyLabel="Nothing yet" />);
    expect(
      screen.getByRole("img", { name: "New listeners: Nothing yet" }),
    ).toBeInTheDocument();
  });

  it("keeps the plot area at the requested height when empty (no collapsed axis)", () => {
    render(<BarChart title="New listeners" data={[]} height={150} />);
    const empty = screen.getByRole("img", { name: /New listeners/ });
    expect(empty).toHaveStyle({ height: "150px" });
  });
});
