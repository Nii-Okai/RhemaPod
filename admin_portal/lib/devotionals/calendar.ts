/**
 * Pure helpers for Library › Devotionals (plan-daily-devotional A1–A5).
 *
 * Devotional dates are calendar DATES (ADR 0022 §1), never instants, so every
 * helper here works on `YYYY-MM-DD` strings in UTC arithmetic. Using local
 * `Date` math would shift a day across DST boundaries.
 */

import type { DisplayStatus } from "@/lib/query/hooks/use-devotionals";

export type CalendarRange = "week" | "month" | "quarter";

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today in the browser's own calendar (what the staff member thinks of as "today"). */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDate(d);
}

export function addMonths(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIsoDate(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  return parse(iso).getUTCDay();
}

/** Monday of the week containing `iso` (weeks start Monday in the design). */
export function startOfWeek(iso: string): string {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * The inclusive [from, to] dates a range view covers, anchored on `anchor`.
 * Week = Mon–Sun; month = the calendar month; quarter = three months from the
 * anchor's month (a rolling quarter, which is how planners actually think).
 */
export function rangeFor(view: CalendarRange, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const from = startOfMonth(anchor);
  const months = view === "month" ? 1 : 3;
  return { from, to: addDays(addMonths(from, months), -1) };
}

/** Move the anchor one view-length backwards (-1) or forwards (+1). */
export function shiftAnchor(view: CalendarRange, anchor: string, dir: -1 | 1): string {
  if (view === "week") return addDays(startOfWeek(anchor), 7 * dir);
  return addMonths(startOfMonth(anchor), (view === "month" ? 1 : 3) * dir);
}

/**
 * Month grid cells (Mon-first), padded with `null` so the first of the month
 * lands under its weekday and the grid is whole weeks.
 */
export function monthGrid(monthStart: string): (string | null)[] {
  const lead = (weekday(monthStart) + 6) % 7;
  const nextMonth = addMonths(monthStart, 1);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = monthStart; d < nextMonth; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** "Mon 9 Nov" */
export function dayLabel(iso: string): string {
  return `${WEEKDAYS_SHORT[weekday(iso)]} ${Number(iso.slice(8, 10))} ${
    MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]
  }`;
}

/** "9 Nov – 15 Nov 2026" / "November 2026" / "Nov 2026 – Jan 2027" */
export function rangeLabel(view: CalendarRange, from: string, to: string): string {
  if (view === "month") return monthLabel(from);
  if (view === "quarter") {
    return `${MONTHS_SHORT[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)} – ${
      MONTHS_SHORT[Number(to.slice(5, 7)) - 1]
    } ${to.slice(0, 4)}`;
  }
  const short = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`;
  return `${short(from)} – ${short(to)} ${to.slice(0, 4)}`;
}

// ── Status vocabulary ────────────────────────────────────────────────────────
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  rejected: "Changes requested",
  archived: "Archived",
  scheduled: "Scheduled",
  published: "Published",
  evergreen: "Evergreen",
};

/** Tailwind classes for a status pill. Text always carries the label, so colour is never the only cue. */
export const STATUS_TONE: Record<DisplayStatus, string> = {
  draft: "bg-neutral-badge text-ink-soft",
  pending_review: "bg-wheat-tint text-wheat-text",
  rejected: "bg-rose-tint text-rose-text",
  archived: "bg-neutral-badge text-ink-faint",
  scheduled: "bg-slate-tint text-slate-text",
  published: "bg-sage-tint text-sage-text",
  evergreen: "bg-sage-tint text-sage-text",
};

/** A day counts as covered for the gap alert when its devotional will go live. */
export function isCovered(status: DisplayStatus | undefined): boolean {
  return status === "scheduled" || status === "published";
}

/** Seconds → "m:ss". */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "m:ss" or plain seconds → seconds; null when blank; NaN when malformed. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(\d+):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** Whether `word` appears in `text` as a whole word, case-insensitively (mirrors the server check). */
export function wordInPassage(word: string, text: string): boolean {
  const w = word.trim();
  if (!w) return true;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_'])${escaped}([^\\p{L}\\p{N}_']|$)`, "iu").test(text);
}

/** The words of a passage a planner can pick as the suggested word (deduped, ≥3 letters). */
export function candidateWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[^\p{L}'’]+/u)) {
    const w = raw.replace(/^['’]+|['’]+$/g, "");
    const key = w.toLowerCase();
    if (w.length >= 3 && !seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}
