import { NextResponse } from "next/server";

// Placeholder — implemented in W4 (straight pass-through to
// POST /api/v1/auth/forgot-password; always the same generic response). §A.2.
export function POST() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}
