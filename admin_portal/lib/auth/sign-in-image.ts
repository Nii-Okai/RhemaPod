/**
 * The sign-in screen's photo URL, read server-side from the public church
 * settings (`GET /settings/public`, no auth). Set in Settings › Profile.
 *
 * Fails soft: any error, a slow backend (2s), or no image set → `null`, and
 * the screen shows its built-in artwork. Cached by Next for five minutes,
 * the same lifetime the backend gives the public settings, well inside the
 * signed URL's validity window.
 */

import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";

const TIMEOUT_MS = 2000;
const REVALIDATE_SECONDS = 300;

export async function loadSignInImageUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${BACKEND_API_PREFIX}/settings/public`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sign_in_image_url?: unknown };
    const url = body.sign_in_image_url;
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}
