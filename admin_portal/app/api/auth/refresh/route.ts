import { NextResponse } from "next/server";

// Placeholder — implemented in W4 (rotate the token pair, reset cookies;
// preemptive refresh with per-process in-flight dedupe). Plan §A.2.
export function POST() {
  return NextResponse.json({ detail: "Not implemented" }, { status: 501 });
}
