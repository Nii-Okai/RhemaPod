import { NextResponse } from "next/server";

// Placeholder — implemented in W4 (token + new password -> POST
// /api/v1/auth/reset-password; on success redirect to /login with a banner,
// no auto-login). Plan §A.2 "Invite acceptance / set-password".
export function POST() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}
