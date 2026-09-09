import { describe, expect, it } from "vitest";

import {
  announcementWindow,
  ANNOUNCEMENT_WINDOW_TONE_CLASS,
} from "@/components/announcements/announcement-window";

/* W13 — the "Window" column. Pure `{publish_at, expires_at, is_visible}` →
   `{text, tone}`. Locks the three forms the acceptance criterion names AND the
   rule that the server's `is_visible` wins the live / not-live decision even
   when the dates alone would say otherwise. */

// A fixed "now" so "future" / "past" are deterministic: 2026-03-05.
const NOW = Date.parse("2026-03-05T12:00:00Z");

const base = { publish_at: null, expires_at: null, is_visible: false };

describe("announcementWindow — text", () => {
  it("live, with an expiry → `Mon D → Mon D`", () => {
    const w = announcementWindow(
      {
        publish_at: "2026-03-04T12:00:00Z",
        expires_at: "2026-03-11T12:00:00Z",
        is_visible: true,
      },
      NOW,
    );
    expect(w.text).toBe("Mar 4 → Mar 11");
    expect(w.tone).toBe("live");
  });

  it("live, no expiry → `Mon D → —`", () => {
    const w = announcementWindow(
      { publish_at: "2026-03-01T12:00:00Z", expires_at: null, is_visible: true },
      NOW,
    );
    expect(w.text).toBe("Mar 1 → —");
    expect(w.tone).toBe("live");
  });

  it("a future publish date → scheduled, text still `Mon D → …`", () => {
    const w = announcementWindow(
      {
        publish_at: "2026-03-20T12:00:00Z",
        expires_at: "2026-03-27T12:00:00Z",
        is_visible: false,
      },
      NOW,
    );
    expect(w.text).toBe("Mar 20 → Mar 27");
    expect(w.tone).toBe("scheduled");
  });

  it("a window whose expiry is in the past, not visible → ended", () => {
    const w = announcementWindow(
      {
        publish_at: "2026-02-02T12:00:00Z",
        expires_at: "2026-02-09T12:00:00Z",
        is_visible: false,
      },
      NOW,
    );
    expect(w.text).toBe("Feb 2 → Feb 9");
    expect(w.tone).toBe("ended");
  });

  it("publish_at just slipped past on the client clock, is_visible not yet refreshed → still scheduled, NOT ended", () => {
    // pub one minute ago, expiry a week out, is_visible false: the 60s refetch
    // hasn't flipped is_visible yet. This row is about to go live — treating it
    // as "ended" (ink-faint) for up to a minute would misread it.
    const w = announcementWindow(
      {
        publish_at: "2026-03-05T11:59:00Z",
        expires_at: "2026-03-12T12:00:00Z",
        is_visible: false,
      },
      NOW,
    );
    expect(w.text).toBe("Mar 5 → Mar 12");
    expect(w.tone).toBe("scheduled");
  });

  it("publish_at in the past, no expiry, not visible → scheduled (no past expiry ⇒ not ended)", () => {
    const w = announcementWindow(
      {
        publish_at: "2026-03-04T12:00:00Z",
        expires_at: null,
        is_visible: false,
      },
      NOW,
    );
    expect(w.text).toBe("Mar 4 → —");
    expect(w.tone).toBe("scheduled");
  });

  it("no publish date at all → `not scheduled` / unscheduled", () => {
    const w = announcementWindow(base, NOW);
    expect(w.text).toBe("not scheduled");
    expect(w.tone).toBe("unscheduled");
  });

  it("an unparseable date is treated as absent", () => {
    const w = announcementWindow(
      { publish_at: "not-a-date", expires_at: null, is_visible: false },
      NOW,
    );
    expect(w.text).toBe("not scheduled");
    expect(w.tone).toBe("unscheduled");
  });
});

describe("announcementWindow — is_visible wins the live decision", () => {
  it("dates say the window is open now, but is_visible is false → NOT live (shown as scheduled)", () => {
    // publish in the past, expiry in the future: naive date logic says "live".
    // is_visible false wins → not live; and with the expiry still ahead it's
    // "about to be / just wasn't" territory, so "scheduled", never "ended".
    const w = announcementWindow(
      {
        publish_at: "2026-03-01T12:00:00Z",
        expires_at: "2026-03-31T12:00:00Z",
        is_visible: false,
      },
      NOW,
    );
    expect(w.tone).not.toBe("live");
    expect(w.tone).toBe("scheduled");
  });

  it("dates look expired, but is_visible is true (clock skew) → still live", () => {
    const w = announcementWindow(
      {
        publish_at: "2026-01-01T12:00:00Z",
        expires_at: "2026-02-01T12:00:00Z",
        is_visible: true,
      },
      NOW,
    );
    expect(w.tone).toBe("live");
  });
});

describe("ANNOUNCEMENT_WINDOW_TONE_CLASS", () => {
  it("mutes ended / unscheduled, keeps live / scheduled at ink-muted", () => {
    expect(ANNOUNCEMENT_WINDOW_TONE_CLASS.live).toBe("text-ink-muted");
    expect(ANNOUNCEMENT_WINDOW_TONE_CLASS.scheduled).toBe("text-ink-muted");
    expect(ANNOUNCEMENT_WINDOW_TONE_CLASS.ended).toBe("text-ink-faint");
    expect(ANNOUNCEMENT_WINDOW_TONE_CLASS.unscheduled).toBe("text-ink-faint");
  });
});
