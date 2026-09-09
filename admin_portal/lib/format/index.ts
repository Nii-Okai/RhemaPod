// Formatting helpers (plan §A.1). Filled as screens need them.
//
// W7 (Sermons list): `formatDuration` for the mono duration cell — `31:02`,
// `1:05:09`; an em dash is rendered by the caller when the value is null.
//
// W8 (Sermon editor): `formatRelativeTime` drives the mono "saved N min ago"
// autosave stamp (§A.4 — the stamp reflects the last successful save, relative
// and re-rendered on an interval); `formatBytes` labels a read-only upload-job
// row's size.

/**
 * Seconds → a clock string. Under an hour: `m:ss` (no leading zero on the
 * minutes, matching the design's `31:02`). An hour or more: `h:mm:ss`.
 * A non-finite or negative input returns an em dash.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (
    totalSeconds == null ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "—";
  }
  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * A short, human relative-past string for the autosave stamp: `just now`,
 * `1 min ago`, `42 min ago`, `3 hr ago`, `2 days ago`. Anything a week or more
 * back falls through to an absolute short date so "saved 340 days ago" never
 * shows. A future `from` (clock skew) clamps to `just now`.
 *
 * `now` is injectable so the interval-driven re-render in the editor and the
 * unit test both stay deterministic.
 */
export function formatRelativeTime(
  from: number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (from == null) return "";
  const then = from instanceof Date ? from.getTime() : from;
  if (!Number.isFinite(then)) return "";

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Whole days elapsed between `from` and `now` (floored). A null/invalid `from`
 * or a future `from` (clock skew) returns 0 — never a negative count.
 *
 * Drives the Review queue's "waiting N days" provenance line and the header
 * "oldest waiting N days" (W10). `now` is injectable so the screen and its
 * tests stay deterministic.
 */
export function daysSince(
  from: string | number | Date | null | undefined,
  now: number = Date.now(),
): number {
  const then = toEpoch(from);
  if (then == null) return 0;
  const elapsed = now - then;
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 86_400_000);
}

/**
 * Fractional hours elapsed between `from` and `now`. Same null/skew handling as
 * {@link daysSince} (0, never negative). Used for the Review queue's >48h
 * "waiting more than 2 days" alert threshold (W10).
 */
export function hoursSince(
  from: string | number | Date | null | undefined,
  now: number = Date.now(),
): number {
  const then = toEpoch(from);
  if (then == null) return 0;
  const elapsed = now - then;
  if (elapsed <= 0) return 0;
  return elapsed / 3_600_000;
}

function toEpoch(
  value: string | number | Date | null | undefined,
): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A URL `?page=` value → a safe 1-based page number: a non-finite, sub-1, or
 * fractional input floors/clamps to `1`. One home for the clamp the Review
 * queue screen, its `useReviewQueue` hook and its `loadReviewQueue` loader all
 * need — they must agree on the page they render, fetch and key on (W10 review
 * pass).
 */
export function clampPage(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Bytes → a one-decimal binary size (`1.4 GB`, `812 KB`, `0 B`). Used only for
 * the read-only upload-job rows in the editor's Media card (W8); the live
 * "1.4 / 2.2 GB" progress line is the XHR uploader's job in W9.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
