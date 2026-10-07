import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    let b2Origin = "";
    try {
      b2Origin = new URL(process.env.B2_ENDPOINT ?? "").origin;
    } catch {
      // Keep the policy valid if B2 is not configured in this environment.
    }
    const scriptPolicy = process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          scriptPolicy,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          `img-src 'self' data: blob: https://res.cloudinary.com${b2Origin ? ` ${b2Origin}` : ""}`,
          `media-src 'self' blob: https://res.cloudinary.com${b2Origin ? ` ${b2Origin}` : ""}`,
          `connect-src 'self' https://api.cloudinary.com${b2Origin ? ` ${b2Origin}` : ""}`,
        ].join("; "),
      },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
    ];

    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
