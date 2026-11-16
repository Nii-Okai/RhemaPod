/**
 * Browser `User-Agent` forwarding for the backend audit trail
 * (`plans/plan-admin-settings.md` S8).
 *
 * Every BFF → FastAPI call is a server-side `fetch`, so without this the
 * backend's `audit_log.user_agent` would record Node's own UA for every staff
 * login and staff mutation. The browser's UA is client-controlled, which is
 * fine for an informational audit column (it is never a trust input), but it
 * must not be able to inject or split a downstream header: control characters
 * (CR/LF included) are removed and the value is cut to the column's 512.
 */

const USER_AGENT = "user-agent";
const UA_MAX = 512;

/** The inbound browser UA, sanitised, or `null` when absent or empty. */
export function userAgentFrom(headers: Headers): string | null {
  const raw = headers.get(USER_AGENT);
  if (!raw) return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, UA_MAX);
  return cleaned || null;
}

/** Spreadable header record for a plain `fetch` init. */
export function userAgentHeaders(userAgent: string | null | undefined): Record<string, string> {
  return userAgent ? { [USER_AGENT]: userAgent } : {};
}

/** Set the forwarded UA on an outbound `Headers`, or nothing when absent. */
export function setUserAgent(headers: Headers, userAgent: string | null): void {
  if (userAgent) headers.set(USER_AGENT, userAgent);
}
