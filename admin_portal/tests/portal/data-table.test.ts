import { describe, it, expect } from "vitest";

import {
  gridTemplateColumns,
  headerMode,
  footerModel,
  ariaColCount,
} from "@/components/portal/data-table";

describe("gridTemplateColumns", () => {
  const WIDTHS = ["2.4fr", "1.1fr", "1fr", "84px", "74px", "1.1fr"];

  it("composes 44px <widths…> 40px with both the checkbox and actions tracks", () => {
    expect(gridTemplateColumns(WIDTHS, { selectable: true, rowActions: true })).toBe(
      "44px 2.4fr 1.1fr 1fr 84px 74px 1.1fr 40px",
    );
  });

  it("omits both extra tracks by default", () => {
    expect(gridTemplateColumns(WIDTHS)).toBe(
      "2.4fr 1.1fr 1fr 84px 74px 1.1fr",
    );
  });

  it("adds only the leading 44px track when selectable", () => {
    expect(gridTemplateColumns(["1fr", "80px"], { selectable: true })).toBe(
      "44px 1fr 80px",
    );
  });

  it("adds only the trailing 40px track when rowActions", () => {
    expect(gridTemplateColumns(["1fr", "80px"], { rowActions: true })).toBe(
      "1fr 80px 40px",
    );
  });

  it("degenerates to just the framing tracks with no columns", () => {
    expect(gridTemplateColumns([], { selectable: true, rowActions: true })).toBe(
      "44px 40px",
    );
  });
});

describe("headerMode", () => {
  it("shows columns when selection is off or empty", () => {
    expect(headerMode({ selectable: false, selectedCount: 5 })).toBe("columns");
    expect(headerMode({ selectable: true, selectedCount: 0 })).toBe("columns");
  });

  it("swaps to the bulk bar once anything is selected", () => {
    expect(headerMode({ selectable: true, selectedCount: 1 })).toBe("bulk");
  });
});

describe("footerModel", () => {
  const onPageChange = () => {};

  it("renders the footer + pagination when all three pagination props are present", () => {
    expect(
      footerModel({ rangeLabel: "1–6 of 128", page: 1, pageCount: 22, onPageChange }),
    ).toEqual({ footer: true, pagination: true });
  });

  it("renders the footer for a rangeLabel alone", () => {
    expect(footerModel({ rangeLabel: "1–6 of 128" })).toEqual({
      footer: true,
      pagination: false,
    });
  });

  it("does not render pagination when onPageChange is missing", () => {
    expect(footerModel({ page: 1, pageCount: 22 })).toEqual({
      footer: false,
      pagination: false,
    });
  });

  it("treats page/pageCount 0 as present (not nullish)", () => {
    expect(footerModel({ page: 0, pageCount: 0, onPageChange })).toEqual({
      footer: true,
      pagination: true,
    });
  });

  it("renders nothing with no footer props at all", () => {
    expect(footerModel({})).toEqual({ footer: false, pagination: false });
  });
});

describe("ariaColCount", () => {
  it("counts the checkbox and actions tracks", () => {
    expect(
      ariaColCount({ columnCount: 5, selectable: true, rowActions: true }),
    ).toBe(7);
  });

  it("is just the column count with neither", () => {
    expect(ariaColCount({ columnCount: 5 })).toBe(5);
  });
});
