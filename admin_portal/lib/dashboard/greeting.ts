/**
 * Greeting name for the Dashboard header (design Screen 2: "Good morning, Ada").
 *
 * The name comes from the session (`SessionUser.name`, i.e. the backend
 * `full_name`), never a request. First whitespace-delimited token; `null` when
 * there is no usable name, so the header falls back to a plain "Good morning".
 *
 * The greeting is fixed to "Good morning" — the design and the design README
 * both show exactly that, with no time-of-day variation, so none is built
 * (plan §W23 greeting block: "time-of-day aware IF the design shows it").
 * Pure — unit-tested directly.
 */

export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}
