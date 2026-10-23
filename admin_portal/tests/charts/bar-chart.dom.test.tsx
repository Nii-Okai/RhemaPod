import * as React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { BarChart, niceAxis, type BarChartDatum } from "@/components/charts/BarChart";

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

  it("scales bar heights linearly, the tallest reaching the top gridline", () => {
    const { container } = render(
      <BarChart
        title="New listeners"
        height={200}
        data={series([10, 20, 30, 40, 50, 60, 70, 80])}
      />,
    );
    const rendered = bars(container);

    // 80 is already a round axis top, so the tallest bar fills the plot
    // below the room kept for the value labels.
    const tallest = heightOf(rendered[7]);
    expect(tallest).toBeGreaterThan(170);
    expect(tallest).toBeLessThanOrEqual(200);
    // Half the max value -> half the height; a quarter -> a quarter.
    expect(heightOf(rendered[3]) / tallest).toBeCloseTo(0.5, 5);
    expect(heightOf(rendered[1]) / tallest).toBeCloseTo(0.25, 5);
  });

  it("draws round y-axis ticks from zero to at least the max", () => {
    const { container } = render(
      <BarChart title="Plays" data={series([3, 7, 0, 11, 2, 0, 1, 4])} />,
    );
    const ticks = Array.from(container.querySelectorAll('[data-slot="bar-chart-tick"] text')).map(
      (el) => el.textContent,
    );
    expect(ticks).toEqual(["0", "5", "10", "15"]);
  });

  it("prints values above the bars while they are wide enough", () => {
    const { container } = render(<BarChart title="Plays" data={series([1, 0, 3, 0, 0, 0, 0, 9])} />);
    const values = Array.from(container.querySelectorAll('[data-slot="bar-chart-value"]')).map(
      (el) => el.textContent,
    );
    expect(values).toEqual(["1", "3", "9"]);
  });

  it("shows a tooltip with the full label and unit on hover, and on keyboard focus", () => {
    const data = series([1, 2, 3, 4, 5, 6, 7, 8]).map((d, i) => ({
      ...d,
      tooltip: `Week ${i + 1}`,
    }));
    const { container } = render(
      <BarChart title="Plays" data={data} unit={["play", "plays"]} />,
    );
    const hits = container.querySelectorAll('[data-slot="bar-chart-hit"]');
    fireEvent.pointerEnter(hits[0]);
    expect(screen.getByRole("status")).toHaveTextContent("Week 1: 1 play");
    fireEvent.pointerEnter(hits[2]);
    expect(screen.getByRole("status")).toHaveTextContent("Week 3: 3 plays");

    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Week 1: 1 play");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Week 2: 2 plays");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
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

  it("renders a single non-zero bucket with the rest flat on the baseline (n=1)", () => {
    const { container } = render(
      <BarChart
        title="New listeners"
        height={150}
        data={series([0, 0, 0, 5, 0, 0, 0, 0])}
      />,
    );
    const rendered = bars(container);
    expect(rendered).toHaveLength(8);

    const drawn = rendered.filter((el) => heightOf(el) > 0);
    expect(drawn).toHaveLength(1);
    expect(rendered[3]).toBe(drawn[0]);
    expect(heightOf(drawn[0])).toBeGreaterThan(75);

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

describe("niceAxis", () => {
  it("picks whole, round steps", () => {
    expect(niceAxis(1)).toEqual({ step: 1, top: 1 });
    expect(niceAxis(5)).toEqual({ step: 2, top: 6 });
    expect(niceAxis(80)).toEqual({ step: 20, top: 80 });
    expect(niceAxis(1234)).toEqual({ step: 500, top: 1500 });
    expect(niceAxis(0)).toEqual({ step: 1, top: 1 });
  });
});
