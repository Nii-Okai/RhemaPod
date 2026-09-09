import { describe, expect, it } from "vitest";

import {
  episodeNumberLabel,
  reorderEpisodes,
  seriesFooterLine,
  sortEpisodes,
  type OrderableEpisode,
} from "@/lib/series/episodes";

/* W11 / Batch 5 — the pure episode-order maths. No DOM, no network. The reorder
   recompute now produces the full ordered list renumbered 1..N by position
   (matching the backend's atomic `PUT .../episode-order`), plus the client-side
   locked-span refusal. */

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
    const { order, refused } = reorderEpisodes(gapped, 1, 1);
    expect(refused).toBe(false);
    expect(order.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("move down by one swaps the pair and renumbers 1..N by position", () => {
    const { order, refused } = reorderEpisodes(gapped, 0, 1);
    expect(refused).toBe(false);
    // The backend renumbers the whole series 1..N — no gaps survive a reorder.
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("move up across a span rotates the block and renumbers 1..N", () => {
    // Move c (index 2) to the top.
    const { order } = reorderEpisodes(gapped, 2, 0);
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("numbers a previously-null episode by its new position too", () => {
    const withNull = sortEpisodes([ep("a", 1), ep("c", 2), ep("z", null)]);
    const { order } = reorderEpisodes(withNull, 2, 0);
    expect(order.map((e) => [e.id, e.episode_number])).toEqual([
      ["z", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("ignores an out-of-range index (input order, not refused)", () => {
    expect(reorderEpisodes(gapped, 0, 9).order.map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(reorderEpisodes(gapped, 0, 9).refused).toBe(false);
    expect(reorderEpisodes(gapped, -1, 0).order.map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  describe("locked (in-review) episodes are immovable fixed points", () => {
    const rows = [ep("a", 1), ep("b", 3), ep("c", 5), ep("d", 7)];

    it("refuses a move whose span contains a locked row (input order untouched)", () => {
      // Move d (idx 3) up to idx 1 — the span [1,3] contains locked c.
      const out = reorderEpisodes(rows, 3, 1, new Set(["c"]));
      expect(out.refused).toBe(true);
      expect(out.order.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("refuses a move of a locked row itself", () => {
      const out = reorderEpisodes(rows, 2, 0, new Set(["c"]));
      expect(out.refused).toBe(true);
      expect(out.order.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("allows a move whose span clears every locked row", () => {
      // Swap a and b; locked c/d are outside the span.
      const out = reorderEpisodes(rows, 0, 1, new Set(["c", "d"]));
      expect(out.refused).toBe(false);
      expect(out.order.map((e) => [e.id, e.episode_number])).toEqual([
        ["b", 1],
        ["a", 2],
        ["c", 3],
        ["d", 4],
      ]);
    });

    it("is a plain reorder when the locked set is empty", () => {
      const out = reorderEpisodes(rows, 0, 1, new Set());
      expect(out.refused).toBe(false);
      expect(out.order.map((e) => e.id)).toEqual(["b", "a", "c", "d"]);
    });
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
