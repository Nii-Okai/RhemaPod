import { describe, expect, it } from "vitest";

import {
  episodeNumberLabel,
  reorderEpisodes,
  seriesFooterLine,
  sortEpisodes,
  type OrderableEpisode,
} from "@/lib/series/episodes";

/* W11 — the pure episode-order maths. No DOM, no network: the reorder recompute
   is the load-bearing bit (one PATCH per changed episode, gaps preserved), so
   it gets its own suite. */

const ep = (
  id: string,
  episode_number: number | null,
  title = id.toUpperCase(),
  status = "draft",
): OrderableEpisode => ({ id, title, episode_number, status });

describe("sortEpisodes", () => {
  it("orders by episode_number ascending, nulls last, then title", () => {
    const out = sortEpisodes([
      ep("c", 4),
      ep("z", null, "Zeta"),
      ep("a", 1),
      ep("b", 3),
      ep("y", null, "Alpha"),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c", "y", "z"]);
  });
});

describe("reorderEpisodes", () => {
  const gapped = [ep("a", 1), ep("b", 3), ep("c", 4)];

  it("is a no-op when from === to", () => {
    const { order, patches } = reorderEpisodes(gapped, 1, 1);
    expect(patches).toEqual([]);
    expect(order.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("move down by one swaps just the two numbers (2 PATCHes), gap preserved", () => {
    const { order, patches } = reorderEpisodes(gapped, 0, 1);
    // a (was 1) and b (was 3) trade numbers; c untouched.
    expect(patches).toEqual([
      { id: "b", title: "B", episode_number: 1 },
      { id: "a", title: "A", episode_number: 3 },
    ]);
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["b", 1],
      ["a", 3],
      ["c", 4],
    ]);
  });

  it("move up across a span rotates the block and keeps the number set (incl. the gap)", () => {
    // Move c (index 2, number 4) to the top.
    const { order, patches } = reorderEpisodes(gapped, 2, 0);
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["c", 1],
      ["a", 3],
      ["b", 4],
    ]);
    // Every row in the span changed number → 3 PATCHes; the used set {1,3,4}
    // is unchanged, so "no ep 2" survives.
    expect(patches.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
    expect(patches.map((p) => p.episode_number).sort()).toEqual([1, 3, 4]);
  });

  it("gives a null episode_number a fresh number above the series max", () => {
    const withNull = sortEpisodes([ep("a", 1), ep("c", 2), ep("z", null)]);
    // Move the unnumbered episode to the front.
    const { order } = reorderEpisodes(withNull, 2, 0);
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["z", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("ignores an out-of-range index", () => {
    expect(reorderEpisodes(gapped, 0, 9).patches).toEqual([]);
    expect(reorderEpisodes(gapped, -1, 0).patches).toEqual([]);
  });
});

describe("seriesFooterLine", () => {
  it("pluralises and names the category", () => {
    expect(seriesFooterLine(3, "Teaching")).toBe("3 episodes · Teaching");
    expect(seriesFooterLine(1, "Youth")).toBe("1 episode · Youth");
  });
  it("falls back to Uncategorized with no category", () => {
    expect(seriesFooterLine(0, null)).toBe("0 episodes · Uncategorized");
    expect(seriesFooterLine(2, undefined)).toBe("2 episodes · Uncategorized");
  });
});

describe("episodeNumberLabel", () => {
  it("zero-pads to two digits, em dash for null", () => {
    expect(episodeNumberLabel(1)).toBe("01");
    expect(episodeNumberLabel(12)).toBe("12");
    expect(episodeNumberLabel(103)).toBe("103");
    expect(episodeNumberLabel(null)).toBe("—");
  });
});
