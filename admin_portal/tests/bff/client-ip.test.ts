import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientIpFromHeaders,
  forwardedForHeaders,
  setForwardedFor,
} from "@/lib/auth/client-ip";

/**
 * The BFF is the edge in the dev/compose topology: inbound X-Forwarded-For /
 * X-Real-IP are attacker-fabricated and must never reach the backend's
 * rate-limit key. The real client IP is read ONLY from the configured
 * CLIENT_IP_HEADER (a header the portal's own infra sets from the TCP peer),
 * validated with net.isIP(), and forwarded as exactly one X-Forwarded-For.
 */

afterEach(() => vi.unstubAllEnvs());

describe("clientIpFromHeaders — no CLIENT_IP_HEADER configured", () => {
  it("returns null even when inbound XFF / X-Real-IP are present", () => {
    const h = new Headers({
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-real-ip": "203.0.113.9",
    });
    expect(clientIpFromHeaders(h)).toBeNull();
  });
});

describe("clientIpFromHeaders — CLIENT_IP_HEADER configured", () => {
  it("reads and validates the configured header, ignoring inbound XFF", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    const h = new Headers({
      "x-real-ip": "198.51.100.7",
      "x-forwarded-for": "203.0.113.9", // attacker noise
    });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.7");
  });

  it("accepts an IPv6 literal", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    const h = new Headers({ "x-real-ip": "2001:db8::1" });
    expect(clientIpFromHeaders(h)).toBe("2001:db8::1");
  });

  it("is case-insensitive on the header name", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "X-Real-IP");
    const h = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.7");
  });

  it.each([
    ["a comma list", "198.51.100.7, 10.0.0.1"],
    ["a host:port", "198.51.100.7:4000"],
    ["a bracketed v6", "[2001:db8::1]"],
    ["a non-IP string", "not-an-ip"],
    ["an empty value", "   "],
    ["an embedded-space value (header-split shape)", "198.51.100.7 x-evil: 1"],
  ])("rejects %s → null", (_label, value) => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    const h = new Headers();
    h.set("x-real-ip", value);
    expect(clientIpFromHeaders(h)).toBeNull();
  });
});

describe("forwardedForHeaders", () => {
  it("emits exactly one X-Forwarded-For for a valid IP, and no X-Real-IP", () => {
    expect(forwardedForHeaders("198.51.100.7")).toEqual({
      "x-forwarded-for": "198.51.100.7",
    });
  });

  it("emits nothing for null or a non-IP value", () => {
    expect(forwardedForHeaders(null)).toEqual({});
    expect(forwardedForHeaders("not-an-ip")).toEqual({});
    expect(forwardedForHeaders("198.51.100.7, 10.0.0.1")).toEqual({});
  });
});

describe("setForwardedFor", () => {
  it("sets one validated X-Forwarded-For", () => {
    const h = new Headers();
    setForwardedFor(h, "198.51.100.7");
    expect(h.get("x-forwarded-for")).toBe("198.51.100.7");
    expect(h.get("x-real-ip")).toBeNull();
  });

  it("sets nothing for a non-IP value", () => {
    const h = new Headers();
    setForwardedFor(h, "not-an-ip");
    expect(h.get("x-forwarded-for")).toBeNull();
  });
});
