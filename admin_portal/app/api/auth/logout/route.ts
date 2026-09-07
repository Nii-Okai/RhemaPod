import { NextResponse } from "next/server";

// Placeholder — implemented in W4 (revoke server-side, then clear both cookies
// with Max-Age=0 on the exact same attributes regardless of revoke outcome).
// Plan §A.2 "Logout".
export function POST() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}
