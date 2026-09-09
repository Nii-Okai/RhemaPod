/**
 * Category slug helpers (W12).
 *
 * The backend does **no** server-side slugify: `POST /api/v1/categories` takes a
 * client-supplied `slug` and rejects anything that does not match
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$` (422), plus a 409 on a duplicate. So the portal
 * owns the slugify and shows a live preview the user can override.
 *
 * `slugify` is deliberately literal — it keeps only ASCII `[a-z0-9]`, folds every
 * other run (spaces, underscores, punctuation, accented letters, unicode, emoji)
 * to a single `-`, and trims leading/trailing/repeat separators. It does **not**
 * transliterate: "Café" → "caf", "日本語" → "". The preview field is editable
 * precisely so a user can fix a name that slugs to something poor or empty.
 */

/** The exact pattern the backend enforces on `CategoryCreate.slug`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A display name → a candidate slug. Lowercase; any run of non-`[a-z0-9]`
 * collapses to one `-`; no leading, trailing or repeated `-`. Returns `""` when
 * nothing usable survives (e.g. `"—"`, `"日本語"`, `"   "`).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** True when `slug` is exactly what the backend will accept (non-empty, the
    pattern). Used to block submit and to render the inline field error. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
