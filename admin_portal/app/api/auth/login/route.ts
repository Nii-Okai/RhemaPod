import { NextResponse } from "next/server";

// Placeholder — implemented in W4 (BFF auth: credentials -> POST
// /api/v1/auth/login -> set rp_at + rp_rt httpOnly cookies). Plan §A.2.
export function POST() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}
