import { describe, expect, it } from "vitest";

import {
  availableActions,
  formFrom,
  toBody,
  validate,
  type FormState,
} from "@/components/devotionals/devotional-editor";
import { buildDevotionalPatch } from "@/components/settings/devotional-settings-screen";

const filled = (over: Partial<FormState> = {}): FormState => ({
  ...formFrom(null, "2026-11-09", "kjv"),
  title: "Be still",
  passageRef: "Psalm 46:10",
  passageText: "Be still, and know that I am God.",
  word: "still",
  reflection: "Notice the stillness.",
  prayQuestion: "What is loud today?",
  prayText: "Lord, quiet me.",
  ...over,
});

describe("validate", () => {
  it("passes a complete devotional", () => {
    expect(validate(filled())).toEqual({});
  });

  it("requires a date unless evergreen", () => {
    expect(validate(filled({ date: "" })).date).toBeTruthy();
    expect(validate(filled({ date: "", evergreen: true })).date).toBeUndefined();
  });

  it("requires the suggested word to be in the passage", () => {
    expect(validate(filled({ word: "storm" })).word).toBeTruthy();
  });

  it("checks the sermon moment bounds", () => {
    expect(validate(filled({ momentSermon: "s1", momentStart: "1:00", momentEnd: "0:30" })).momentEnd).toMatch(/after/);
    expect(validate(filled({ momentSermon: "s1", momentStart: "0:00", momentEnd: "10:01" })).momentEnd).toMatch(/10 minutes/);
    expect(validate(filled({ momentSermon: "s1", momentStart: "x", momentEnd: "1:00" })).momentStart).toBeTruthy();
    expect(validate(filled({ momentSermon: "s1", momentStart: "1:00", momentEnd: "2:30" }))).toEqual({});
  });

  it("bounds the Still seconds", () => {
    expect(validate(filled({ stillSeconds: "5" })).stillSeconds).toBeTruthy();
    expect(validate(filled({ stillSeconds: "60" })).stillSeconds).toBeUndefined();
  });
});

describe("toBody", () => {
  it("drops the date for evergreen and blanks to null", () => {
    const b = toBody(filled({ evergreen: true, breathIn: "  ", carryRef: "" }));
    expect(b.date).toBeNull();
    expect(b.still_breath_in).toBeNull();
    expect(b.carry_verse_ref).toBeNull();
  });

  it("sends moment seconds only with a sermon", () => {
    expect(toBody(filled({ momentStart: "1:00", momentEnd: "2:00" })).moment_start_s).toBeNull();
    const b = toBody(filled({ momentSermon: "s1", momentStart: "1:00", momentEnd: "2:00" }));
    expect([b.moment_start_s, b.moment_end_s]).toEqual([60, 120]);
  });
});

describe("availableActions (mirrors the server's TRANSITIONS)", () => {
  const editor = { isManager: false, isAdmin: false, ownWork: true };
  const manager = { isManager: true, isAdmin: false, ownWork: false };
  const managerOwn = { isManager: true, isAdmin: false, ownWork: true };
  const admin = { isManager: true, isAdmin: true, ownWork: true };

  it("lets an editor submit, withdraw and delete their own work only", () => {
    expect(availableActions("draft", editor)).toEqual(["submit", "delete"]);
    expect(availableActions("pending_review", editor)).toEqual(["withdraw"]);
    expect(availableActions("approved", editor)).toEqual([]);
  });

  it("never offers approve outside pending review", () => {
    expect(availableActions("draft", manager)).not.toContain("approve");
    expect(availableActions("pending_review", manager)).toContain("approve");
  });

  it("stops a manager approving their own devotional, but not an admin", () => {
    expect(availableActions("pending_review", managerOwn)).not.toContain("approve");
    expect(availableActions("pending_review", admin)).toContain("approve");
  });

  it("offers request changes and archive on approved, restore on archived", () => {
    expect(availableActions("approved", manager)).toEqual(["reject", "archive"]);
    expect(availableActions("archived", manager)).toEqual(["restore", "delete"]);
  });
});

describe("buildDevotionalPatch", () => {
  const base = {
    version: 4,
    reading_fallback: "text" as const,
    allow_override: true,
    tts_voice: null,
    tts_rate_pct: 90,
    publish_hour: 5,
    gap_alert_days: 14,
    still_seconds: 60,
    default_translation: "kjv",
  };
  it("sends only changed fields with the loaded version", () => {
    const { version: _v, ...draft } = base;
    void _v;
    expect(buildDevotionalPatch(base, { ...draft, reading_fallback: "tts", tts_rate_pct: 80 })).toEqual({
      version: 4,
      reading_fallback: "tts",
      tts_rate_pct: 80,
    });
    expect(buildDevotionalPatch(base, draft)).toEqual({ version: 4 });
  });
});
