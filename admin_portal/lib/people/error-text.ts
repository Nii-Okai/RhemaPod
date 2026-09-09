/**
 * A request failure → the string shown in a card-top `<Alert>` on the Speakers &
 * categories screen (W12). Prefers the backend `detail` and appends the
 * `correlation_id` as a support handle, exactly like the W11 series screen.
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
