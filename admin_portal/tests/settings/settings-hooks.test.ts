import { describe, expect, it } from "vitest";

import {
  buildSettingsPatch,
  isSettingsPatchEmpty,
  toDraft,
  type ChurchSettings,
} from "@/lib/query/hooks/use-church-settings";
import { auditQuery } from "@/lib/query/hooks/use-audit-log";
import { presetRange, reportExportHref, toGranularity } from "@/lib/query/hooks/use-usage-report";
import { axisLabels } from "@/components/settings/reports-screen";

export const SETTINGS: ChurchSettings = {
  church_name: "Watered Garden Church",
  app_display_name: "RhemaPod",
  tagline: null,
  about: null,
  contact_email: "contact@rhemapod.com",
  contact_phone: null,
  website_url: null,
  address: null,
  comment_guidelines: "RhemaPod Comment Guidelines\n\nBe kind.",
  terms_of_use_url: null,
  privacy_policy_url: "https://wateredgarden.org/privacy",
  copyright_notice: null,
  version: 3,
  updated_at: "2026-10-20T09:00:00Z",
  updated_by: "mgr@example.com",
};

describe("buildSettingsPatch", () => {
  it("sends only changed fields plus the loaded version", () => {
    const draft = { ...toDraft(SETTINGS), tagline: "Rooted in the Word" };
    expect(buildSettingsPatch(SETTINGS, draft)).toEqual({
      version: 3,
      tagline: "Rooted in the Word",
    });
  });

  it("sends an emptied optional field as null, and ignores whitespace-only edits", () => {
    const draft = {
      ...toDraft(SETTINGS),
      privacy_policy_url: "   ",
      church_name: "Watered Garden Church  ",
    };
    expect(buildSettingsPatch(SETTINGS, draft)).toEqual({
      version: 3,
      privacy_policy_url: null,
    });
  });

  it("is empty when nothing changed", () => {
    expect(isSettingsPatchEmpty(buildSettingsPatch(SETTINGS, toDraft(SETTINGS)))).toBe(true);
  });
});

describe("auditQuery", () => {
  it("always sends staff_only and turns the inclusive `to` day into the exclusive bound", () => {
    expect(
      auditQuery({ staffOnly: true, from: "2026-10-01", to: "2026-10-31", page: 2 }),
    ).toEqual({
      staff_only: true,
      from: "2026-10-01T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
      limit: 50,
      offset: 50,
    });
  });

  it("drops malformed dates", () => {
    expect(auditQuery({ staffOnly: false, from: "yesterday", page: 1 })).toEqual({
      staff_only: false,
      limit: 50,
      offset: 0,
    });
  });
});

describe("usage report helpers", () => {
  it("presets end with today included, in UTC", () => {
    const now = new Date("2026-10-20T23:30:00Z");
    expect(presetRange("7d", now)).toEqual({ from: "2026-10-14", to: "2026-10-21" });
    expect(presetRange("12m", now)).toEqual({ from: "2025-10-21", to: "2026-10-21" });
  });

  it("each preset has a sensible default granularity", () => {
    expect(toGranularity(null, "30d")).toBe("day");
    expect(toGranularity(null, "12m")).toBe("month");
    expect(toGranularity("week", "12m")).toBe("week");
  });

  it("builds the BFF export link", () => {
    expect(
      reportExportHref({ from: "2026-10-01", to: "2026-10-15", granularity: "week" }, "top_sermons"),
    ).toBe(
      "/api/bff/admin/analytics/report/export?from=2026-10-01&to=2026-10-15&granularity=week&kind=top_sermons",
    );
  });
});

describe("axisLabels", () => {
  it("keeps every label for a short series", () => {
    expect(axisLabels(["2026-10-05", "2026-10-12"], "week")).toEqual(["5 Oct", "12 Oct"]);
  });

  it("thins a dense daily axis to at most eight labels", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10),
    );
    const labels = axisLabels(days, "day");
    expect(labels.filter(Boolean).length).toBeLessThanOrEqual(8);
    expect(labels[0]).toBe("21 Sept");
  });

  it("puts the year on month labels so two Octobers differ", () => {
    expect(axisLabels(["2025-10-21", "2026-10-01"], "month")).toEqual(["Oct ’25", "Oct ’26"]);
  });
});
