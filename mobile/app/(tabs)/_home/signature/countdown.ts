export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
}

const MINUTE_MS = 60 * 1000;

/** Whole days, hours and minutes until `target`, rounded up to the next minute so the
 * card never reads 00:00:00 while the release is still seconds away. Null once passed. */
export function countdownParts(target: Date, now: Date): CountdownParts | null {
  const ms = target.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / MINUTE_MS);
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Sunday 9:00 AM" in the phone's own time zone. Built by hand rather than with
 * `toLocaleString`, whose options Hermes only partly supports. */
export function releaseLabel(target: Date): string {
  const hours = target.getHours();
  const minutes = String(target.getMinutes()).padStart(2, '0');
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${WEEKDAYS[target.getDay()]} ${hour12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
