import { ApiError } from '../../../lib/api/errors';

/** Server messages that are really serialisation noise (a structured `detail` stringified). */
function usableServerMessage(error: ApiError): string | null {
  const message = error.message?.trim();
  if (!message || message.includes('[object')) return null;
  return message;
}

/**
 * What the composer shows for a failed post. A 422 is the server's content rule (links,
 * contact details, a blocklisted word): its message is shown as written — the client runs no
 * URL pre-check of its own, so there is no second rule to drift. 403 is handled by the
 * caller (it re-reads the profile to decide which prompt applies) and never reaches here.
 */
export function postErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return usableServerMessage(error) ?? "This comment can't be posted. Please rephrase.";
    if (error.status === 429) return "You're posting too fast. Try again in a minute.";
    if (error.network) return "Couldn't post. Check your connection and try again.";
  }
  return "Couldn't post. Try again.";
}

/** Failed name save (Me edit or the pre-post prompt). The 422 text is the server's one generic line. */
export function nameErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return usableServerMessage(error) ?? "This name can't be used.";
    if (error.status === 429) return "You've changed your name too many times. Try again later.";
    if (error.network) return "Couldn't save your name. Check your connection and try again.";
  }
  return "Couldn't save your name. Try again.";
}

export function reportErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "You're reporting too fast. Try again later.";
  }
  return "Couldn't send. Try again.";
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
