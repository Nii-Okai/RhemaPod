/**
 * The "Window" column of the Announcements list (W13, design Screen 8).
 *
 * The `.dc.html` renders the window in exactly two shapes, both mono:
 *
 *   • `Sep 8 → Sep 22`  — a publish date, then an expiry (or `→ —` when the
 *                          announcement never expires)
 *   • `not scheduled`    — no publish date at all (an unpublished draft)
 *
 * plus a colour cue: the ink-muted `#6B6055` for a row that is live now or is a
 * genuine future window, and the fainter `#9C9085` for one that has ended or was
 * never scheduled. `announcementWindow()` returns that as a `tone`, and the
 * three "forms" the plan's acceptance names map onto it:
 *
 *   tone         when                                             colour
 *   ────         ────                                             ──────
 *   "live"       is_visible === true                              ink-muted
 *   "scheduled"  not visible, has a publish_at, expiry not yet    ink-muted
 *                past (a future window, OR one whose publish_at
 *                the client clock just passed while the row waits
 *                for the next server refetch to flip is_visible)
 *   "ended"      not visible, expires_at in the past              ink-faint
 *   "unscheduled" no publish_at                                   ink-faint
 *
 * The "ended" test is deliberately expiry-only: a row whose `publish_at` has
 * just slipped past `now` on the client clock (but whose `is_visible` the 60s
 * refetch hasn't refreshed) is about to go live, not finished — calling it
 * "ended" (ink-faint) for up to a minute would misread it. Without an expiry
 * that is genuinely past, such a row stays "scheduled".
 *
 * `is_visible` is the SERVER's computed truth and it WINS the live / not-live
 * decision: if the dates alone would say "should be showing" but `is_visible`
 * is false (clock skew, a just-flipped row, an approved-but-unpublished row),
 * this is *not* "live". The text is still the plain `{pub} → {exp}` — only the
 * tone differs. Pure and total; unit-tested.
 *
 * The plan's prose sketches richer copy ("Scheduled · 4 Mar", "Live · until
 * 11 Mar", "Ended 11 Mar"); the `.dc.html` and design README §8 do not — they
 * show `{Mon D} → {Mon D | —}` / `not scheduled` only. The design wins
 * (logged as a `[GATE 3 Batch 5]` line), so that is what this renders.
 */

export type AnnouncementWindowTone =
  | "live"
  | "scheduled"
  | "ended"
  | "unscheduled";

export interface AnnouncementWindow {
  text: string;
  tone: AnnouncementWindowTone;
}

export interface AnnouncementWindowInput {
  publish_at: string | null;
  expires_at: string | null;
  is_visible: boolean;
}

function parse(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** `Sep 8` — month short + numeric day, matching the `.dc.html`. No year, even
    across a year boundary (the design's Archived row shows `Apr 2 → Apr 9`). */
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function announcementWindow(
  item: AnnouncementWindowInput,
  now: number = Date.now(),
): AnnouncementWindow {
  const pub = parse(item.publish_at);
  const exp = parse(item.expires_at);

  const text =
    pub != null
      ? `${fmtDate(pub)} → ${exp != null ? fmtDate(exp) : "—"}`
      : "not scheduled";

  let tone: AnnouncementWindowTone;
  if (item.is_visible) {
    tone = "live";
  } else if (pub == null) {
    tone = "unscheduled";
  } else if (exp != null && exp <= now) {
    tone = "ended";
  } else {
    // Has a publish date, no past expiry: a genuine future window, or a row
    // whose publish_at just passed and is waiting on the next refetch to flip
    // is_visible. Either way it is upcoming, not finished.
    tone = "scheduled";
  }

  return { text, tone };
}

/** Tailwind text-colour class per tone (design colour cue). */
export const ANNOUNCEMENT_WINDOW_TONE_CLASS: Record<
  AnnouncementWindowTone,
  string
> = {
  live: "text-ink-muted",
  scheduled: "text-ink-muted",
  ended: "text-ink-faint",
  unscheduled: "text-ink-faint",
};
