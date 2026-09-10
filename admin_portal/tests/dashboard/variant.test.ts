import { describe, expect, it } from "vitest";

import { firstNameOf } from "@/lib/dashboard/greeting";
import { dashboardShowsAnalytics } from "@/lib/dashboard/variant";

/* W23 — the server-resolved Dashboard role branch (plan §A.1 / decision 1a).
   Pure resolvers, tested directly: the branch is a rendering decision made off
   the session role, not a client-side guard. */

describe("dashboardShowsAnalytics", () => {
  it("is true only for manager and admin", () => {
    expect(dashboardShowsAnalytics("manager")).toBe(true);
    expect(dashboardShowsAnalytics("admin")).toBe(true);
  });

  it("is false for editor — greeting + WIP cards only", () => {
    expect(dashboardShowsAnalytics("editor")).toBe(false);
  });

  it("is false for viewer or any unknown role", () => {
    expect(dashboardShowsAnalytics("viewer")).toBe(false);
    expect(dashboardShowsAnalytics("")).toBe(false);
    expect(dashboardShowsAnalytics("superadmin")).toBe(false);
  });
});

describe("firstNameOf", () => {
  it("takes the first whitespace-delimited token", () => {
    expect(firstNameOf("Ada Nwosu")).toBe("Ada");
    expect(firstNameOf("  Meg   Ojo  ")).toBe("Meg");
    expect(firstNameOf("Sam")).toBe("Sam");
  });

  it("is null when there is no usable name", () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
  });
});
