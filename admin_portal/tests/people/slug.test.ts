import { describe, expect, it } from "vitest";

import { isValidSlug, slugify } from "@/lib/people/slug";

/* W12 — `slugify` is the client-side slug the Categories card previews and sends
   (`POST /api/v1/categories` does no server slugify). Pure, so it is a node
   test. Every case below can actually fail — exact string equality, no
   `toContain`. */

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("GRACE")).toBe("grace");
    expect(slugify("Sunday Morning")).toBe("sunday-morning");
  });

  it("folds spaces and underscores to a single hyphen", () => {
    expect(slugify("faith and works")).toBe("faith-and-works");
    expect(slugify("faith_and_works")).toBe("faith-and-works");
    expect(slugify("a   b\t c")).toBe("a-b-c");
  });

  it("strips punctuation", () => {
    expect(slugify("Q&A / notes!")).toBe("q-a-notes");
    expect(slugify("(re)new.ed")).toBe("re-new-ed");
    expect(slugify("2 Cor. 5:17")).toBe("2-cor-5-17");
  });

  it("strips unicode letters and emoji", () => {
    expect(slugify("Café ☕ series")).toBe("caf-series");
    expect(slugify("日本語")).toBe("");
    expect(slugify("grace 🙏 alone")).toBe("grace-alone");
  });

  it("collapses leading, trailing and repeated hyphens", () => {
    expect(slugify("--a--b--")).toBe("a-b");
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("already-a-slug")).toBe("already-a-slug");
  });

  it("returns an empty string when nothing usable survives", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
    expect(slugify("—")).toBe("");
    expect(slugify("☕")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts exactly what the backend pattern accepts", () => {
    expect(isValidSlug("sunday-morning")).toBe(true);
    expect(isValidSlug("a1")).toBe(true);
    expect(isValidSlug("2-cor-5-17")).toBe(true);
  });

  it("rejects empty, edge hyphens, spaces and uppercase", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-x")).toBe(false);
    expect(isValidSlug("x-")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
    expect(isValidSlug("Upper")).toBe(false);
  });

  it("agrees with slugify — a non-empty slugify output always validates", () => {
    for (const name of ["Sunday Morning", "Q&A / notes!", "Café ☕ series"]) {
      const s = slugify(name);
      if (s !== "") expect(isValidSlug(s)).toBe(true);
    }
  });
});
