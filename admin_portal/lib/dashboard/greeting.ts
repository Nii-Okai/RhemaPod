/**
 * Dashboard header greeting.
 *
 * The name comes from the session (`SessionUser.name`, i.e. the backend
 * `full_name`), never a request. First whitespace-delimited token; `null` when
 * there is no usable name, so the header falls back to the bare greeting.
 *
 * The time of day is read in the church's time zone (Ghana, UTC+0 with no
 * DST), not the server's, so "Good evening" is right for the people using
 * the portal wherever it is hosted. Pure — unit-tested directly.
 */

export const CHURCH_TIME_ZONE = "Africa/Accra";

export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/** "Good morning" before 12:00, "Good afternoon" before 17:00, else
    "Good evening", in `timeZone`. */
export function greetingFor(now: Date, timeZone: string = CHURCH_TIME_ZONE): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
