import { describe, expect, it } from "vitest";

import {
  apiStatusesFor,
  buildSermonsSearch,
  parseSermonsParams,
} from "@/lib/query/hooks/use-sermons-query";

/* W7 — the Sermons list is URL-driven (design "Navigation: URL is source of
   truth"). These cover the pure read (`parseSermonsParams`), the status→API
   mapping, and the write (`buildSermonsSearch`) — filter changes reset the
   page, a page change keeps the filters. No DOM. */

const parse = (query: string) =>
  parseSermonsParams(new URLSearchParams(query));

describe("parseSermonsParams", () => {
  it("defaults everything when there are no params", () => {
    expect(parse("")).toEqual({ status: "all", page: 1 });
  });

  it("reads a full valid query string", () => {
    expect(
      parse(
        "status=in-review&speaker=spk-1&series=ser-2&category=cat-3&tier=paid&q=grace&page=3",
      ),
    ).toEqual({
      status: "in-review",
      speakerId: "spk-1",
      seriesId: "ser-2",
      categoryId: "cat-3",
      tier: "paid",
      q: "grace",
      page: 3,
    });
  });

  it("falls back to 'all' for an unknown status", () => {
    expect(parse("status=archived").status).toBe("all");
    expect(parse("status=").status).toBe("all");
  });

  it("clamps a non-positive / non-numeric page to 1", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-4").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
    expect(parse("page=2.9").page).toBe(2);
  });

  it("drops a junk tier and empty/whitespace text params", () => {
    expect(parse("tier=premium").tier).toBeUndefined();
    expect(parse("speaker=&series=%20&category=%20&q=%20%20")).toEqual({
      status: "all",
      page: 1,
    });
  });
});

describe("apiStatusesFor", () => {
  it("maps each tab to the backend status enum(s)", () => {
    expect(apiStatusesFor("all")).toEqual([]);
    expect(apiStatusesFor("drafts")).toEqual(["draft"]);
    expect(apiStatusesFor("published")).toEqual(["published"]);
    expect(apiStatusesFor("in-review")).toEqual([
      "pending_review",
      "under_review",
    ]);
  });
});

describe("buildSermonsSearch", () => {
  const build = (query: string, patch: Parameters<typeof buildSermonsSearch>[1]) =>
    buildSermonsSearch(new URLSearchParams(query), patch);

  it("writes a filter and omits the default (status=all, page=1)", () => {
    expect(build("", { status: "drafts" })).toBe("status=drafts");
    expect(build("status=drafts", { status: "all" })).toBe("");
  });

  it("resets the page when a filter changes", () => {
    expect(build("status=drafts&page=4", { speaker: "spk-9" })).toBe(
      "speaker=spk-9&status=drafts",
    );
    expect(build("page=3", { status: "published" })).toBe("status=published");
  });

  it("keeps every filter when only the page changes", () => {
    expect(
      build("status=published&speaker=spk-1&tier=paid", { page: 2 }),
    ).toBe("page=2&speaker=spk-1&status=published&tier=paid");
  });

  it("writes and clears the category filter the same way as speaker/series", () => {
    expect(build("", { category: "cat-1" })).toBe("category=cat-1");
    expect(build("status=drafts&page=4", { category: "cat-1" })).toBe(
      "category=cat-1&status=drafts",
    );
    expect(
      build("category=cat-1&status=drafts", { category: undefined }),
    ).toBe("status=drafts");
  });

  it("drops page=1 rather than writing it", () => {
    expect(build("status=drafts&page=5", { page: 1 })).toBe("status=drafts");
  });

  it("clears a filter when its patch value is undefined/empty", () => {
    expect(build("speaker=spk-1&status=drafts", { speaker: undefined })).toBe(
      "status=drafts",
    );
    expect(build("q=grace", { q: "   " })).toBe("");
  });
});
