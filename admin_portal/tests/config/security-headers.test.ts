import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

async function rules(): Promise<HeaderRule[]> {
  expect(typeof nextConfig.headers).toBe("function");
  return (await nextConfig.headers!()) as unknown as HeaderRule[];
}

function headerMap(rs: HeaderRule[], source: string): Map<string, string> {
  const rule = rs.find((r) => r.source === source);
  if (!rule) throw new Error(`no header rule for source ${source}`);
  return new Map(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("next.config security headers (security M4)", () => {
  it("applies the baseline set to every route", async () => {
    const h = headerMap(await rules(), "/:path*");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("omits HSTS outside production (NODE_ENV=test)", async () => {
    const h = headerMap(await rules(), "/:path*");
    expect(h.has("strict-transport-security")).toBe(false);
  });

  it("tightens Referrer-Policy to no-referrer on /api/auth/* and /set-password", async () => {
    const rs = await rules();
    expect(headerMap(rs, "/api/auth/:path*").get("referrer-policy")).toBe(
      "no-referrer",
    );
    expect(headerMap(rs, "/set-password").get("referrer-policy")).toBe(
      "no-referrer",
    );
  });

  it("orders the no-referrer overrides after the baseline block", async () => {
    const rs = await rules();
    const baseline = rs.findIndex((r) => r.source === "/:path*");
    const authOverride = rs.findIndex((r) => r.source === "/api/auth/:path*");
    const setPwOverride = rs.findIndex((r) => r.source === "/set-password");
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(authOverride).toBeGreaterThan(baseline);
    expect(setPwOverride).toBeGreaterThan(baseline);
  });
});
