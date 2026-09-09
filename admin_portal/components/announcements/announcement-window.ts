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
 *   "scheduled"  not visible, publish_at in the future            ink-muted
 *   "ended"      not visible, publish_at in the past (ran / pulled) ink-faint
 *   "unscheduled" no publish_at                                   ink-faint
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
  } else if (pub != null && pub > now) {
    tone = "scheduled";
  } else if (pub != null) {
    tone = "ended";
  } else {
    tone = "unscheduled";
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
