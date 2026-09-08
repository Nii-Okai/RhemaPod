/**
 * Minimal structured logger for the BFF's server-side paths.
 *
 * There is no `structlog` equivalent wired into the portal yet, so this is the
 * floor: one JSON object per line via `console`, so the swallowed-error sites in
 * the auth layer leave a support trail instead of vanishing.
 *
 * NEVER put a token, password, cookie value or raw request/response body in the
 * fields — this is a diagnostic breadcrumb, not an audit log.
 */

type Fields = Record<string, unknown>;

function line(level: "error" | "warn", event: string, fields: Fields): string {
  return JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  });
}

export function logError(event: string, fields: Fields = {}): void {
  console.error(line("error", event, fields));
}

export function logWarn(event: string, fields: Fields = {}): void {
  console.warn(line("warn", event, fields));
}
