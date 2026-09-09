/**
 * `YYYY-MM-DD HH:mm` (local time) ⇄ ISO 8601, for the Announcements editor's
 * "Publish at" / "Expires at" fields (W13, design Screen 8 — mono text inputs
 * showing `2026-09-08 09:00`).
 *
 * Local, not UTC: a church scheduling a 9am notice types `09:00` and means
 * their own clock. The backend column is `DateTime(timezone=True)`, so we send
 * a fully-qualified ISO string (`toISOString()` → UTC `…Z`) and render it back
 * in the browser's zone.
 *
 * Pure; unit-tested. Parsing is strict — a malformed value returns `ok:false`
 * so the panel can show an inline error instead of posting a 422.
 */

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** ISO → `YYYY-MM-DD HH:mm` in local time. Blank/invalid → `""`. */
export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

export type ParsedDateTime =
  | { ok: true; iso: string | null }
  | { ok: false };

/** `YYYY-MM-DD HH:mm` (local) → ISO. Blank → `{ ok: true, iso: null }`.
    Anything not matching the exact shape, or a rolled-over date (month 13,
    day 32, …), → `{ ok: false }`. */
export function parseLocalDateTime(input: string): ParsedDateTime {
  const s = input.trim();
  if (s === "") return { ok: true, iso: null };

  const m = PATTERN.exec(s);
  if (!m) return { ok: false };

  const [, y, mo, da, h, mi] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(da);
  const hour = Number(h);
  const minute = Number(mi);

  const d = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(d.getTime())) return { ok: false };
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return { ok: false };
  }
  return { ok: true, iso: d.toISOString() };
}
