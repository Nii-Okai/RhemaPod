import type { NextConfig } from "next";

/**
 * Security response headers (W4 fix pass, security M4).
 *
 * The backend middleware only stamps FastAPI responses; every byte the portal
 * itself serves (the login page, `/set-password`, the BFF routes) needs its own
 * coverage. HSTS is prod-only — sending it over `http://localhost` in dev pins
 * the dev host to HTTPS in the browser for two years.
 */
const IS_PROD = process.env.NODE_ENV === "production";

const BASELINE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(IS_PROD
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: BASELINE_SECURITY_HEADERS,
      },
      {
        // The `?token=` invite/reset URL must not leak via Referer. This block
        // is last so its Referrer-Policy overrides the baseline one.
        source: "/api/auth/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/set-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
