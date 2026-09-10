/**
 * A request failure → the string shown in a card-top / in-dialog `<Alert>` on
 * the Users & roles screen (W17). Prefers the backend `detail` (the typed
 * message from `auth_service` — "A user with that email already exists", "Only
 * an admin can modify a manager or admin account", …) and appends the
 * `correlation_id` as a support handle, exactly like the W12 people screen.
 */

import { isApiError } from "@/lib/api/errors";

export function errorText(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
