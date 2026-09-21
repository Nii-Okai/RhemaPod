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
  it("hides the Community and Account groups for an editor", () => {
    const ids = navGroupsForRole("editor").map((g) => g.id);
    expect(ids).not.toContain("community");
    expect(ids).not.toContain("account");
    expect(ids).toEqual(["overview", "library", "workflow"]);
  });

  it("drops 'Review queue' but keeps 'Announcements' in Workflow for an editor", () => {
    const workflow = navGroupsForRole("editor").find(
      (g) => g.id === "workflow",
    );
    expect(workflow?.items.map((i) => i.label)).toEqual(["Announcements"]);
  });

  it.each(["manager", "admin"])(
    "shows every group, and both Workflow items, for %s",
    (role) => {
      const groups = navGroupsForRole(role);
      expect(groups.map((g) => g.id)).toEqual([
        "overview",
        "library",
        "workflow",
        "community",
        "account",
      ]);
      const workflow = groups.find((g) => g.id === "workflow");
      expect(workflow?.items.map((i) => i.label)).toEqual([
        "Review queue",
        "Announcements",
      ]);
    },
  );

  it("hides Community/Account/Review queue for an unknown / lower role too (fail closed)", () => {
    const editorish = navGroupsForRole("viewer");
    expect(editorish.map((g) => g.id)).not.toContain("community");
    expect(editorish.map((g) => g.id)).not.toContain("account");
    expect(
      editorish.find((g) => g.id === "workflow")?.items.map((i) => i.label),
    ).toEqual(["Announcements"]);
    expect(roleSeesCommunity("editor")).toBe(false);
    expect(roleSeesCommunity("admin")).toBe(true);
  });

  it("returns a fresh array — never mutates the shared NAV_GROUPS", () => {
    const a = navGroupsForRole("admin");
    a.pop();
    expect(navGroupsForRole("admin")).toHaveLength(5);

    const workflow = navGroupsForRole("admin").find(
      (g) => g.id === "workflow",
    );
    workflow?.items.pop();
    expect(
      navGroupsForRole("admin").find((g) => g.id === "workflow")?.items,
    ).toHaveLength(2);
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
