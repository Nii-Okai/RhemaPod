import { describe, expect, it } from "vitest";

import {
  isNavItemActive,
  navGroupsForRole,
  resolveActiveHref,
  roleSeesCommunity,
} from "@/components/portal/nav-config";

/* W5 — the nav tree is data, filtered by role in the RSC layout so an Editor
   never receives the Community markup (plan §A.7). These assert the data layer
   that decision rides on. */

describe("navGroupsForRole — role gating", () => {
  it("hides the Community group for an editor", () => {
    const ids = navGroupsForRole("editor").map((g) => g.id);
    expect(ids).not.toContain("community");
    expect(ids).toEqual(["overview", "library", "workflow", "account"]);
  });

  it.each(["manager", "admin"])("shows every group for %s", (role) => {
    const ids = navGroupsForRole(role).map((g) => g.id);
    expect(ids).toEqual([
      "overview",
      "library",
      "workflow",
      "community",
      "account",
    ]);
  });

  it("hides Community for an unknown / lower role too (fail closed)", () => {
    expect(navGroupsForRole("viewer").map((g) => g.id)).not.toContain(
      "community",
    );
    expect(roleSeesCommunity("editor")).toBe(false);
    expect(roleSeesCommunity("admin")).toBe(true);
  });

  it("returns a fresh array — never mutates the shared NAV_GROUPS", () => {
    const a = navGroupsForRole("admin");
    a.pop();
    expect(navGroupsForRole("admin")).toHaveLength(5);
  });
});

describe("resolveActiveHref / isNavItemActive — active item follows the URL", () => {
  const groups = navGroupsForRole("admin");

  it("matches an exact route", () => {
    expect(resolveActiveHref("/sermons", groups)).toBe("/sermons");
    expect(resolveActiveHref("/series", groups)).toBe("/series");
    expect(resolveActiveHref("/settings", groups)).toBe("/settings");
  });

  it("lights the section for a nested route (/sermons/123 → Sermons)", () => {
    expect(resolveActiveHref("/sermons/123", groups)).toBe("/sermons");
    expect(isNavItemActive("/sermons", "/sermons/123", groups)).toBe(true);
    expect(isNavItemActive("/sermons/new", "/sermons/123", groups)).toBe(false);
  });

  it("prefers the longer match so /sermons/new → Sermon editor, not Sermons", () => {
    expect(resolveActiveHref("/sermons/new", groups)).toBe("/sermons/new");
    expect(isNavItemActive("/sermons/new", "/sermons/new", groups)).toBe(true);
    expect(isNavItemActive("/sermons", "/sermons/new", groups)).toBe(false);
  });

  it("does not cross-match sibling prefixes (/series ≠ /sermons)", () => {
    expect(isNavItemActive("/sermons", "/series", groups)).toBe(false);
  });

  it("returns null when nothing matches", () => {
    expect(resolveActiveHref("/", groups)).toBeNull();
    expect(resolveActiveHref("/nope", groups)).toBeNull();
  });
});
