import { NextResponse } from "next/server";

// Placeholder — implemented in W4. The single authenticated pass-through to
// /api/v1/<path>: Origin/Sec-Fetch-Site CSRF check on mutating methods,
// preemptive refresh, one 401 retry, the one place an Authorization header is
// attached. Plan §A.2. Every browser data call routes through here.
function notImplemented() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}

export {
  notImplemented as GET,
  notImplemented as POST,
  notImplemented as PUT,
  notImplemented as PATCH,
  notImplemented as DELETE,
};
